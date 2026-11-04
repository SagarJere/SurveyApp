"""Survey audiences: upload preview, apply, list, remove, open to all (docs/04-api.md)."""

import uuid
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import AudienceUpload, Survey, SurveyAudience, SurveyParticipation
from app.services.audience_import import AudienceFileError, parse_audience_file
from app.services.surveys import SurveyAccess

Mode = Literal["append", "replace"]
PAGE_SIZE = 50
# Rows to fix returned with the preview; the full list is in the errors.xlsx download.
PREVIEW_ERROR_LIMIT = 200
_INSERT_BATCH = 2000


async def audience_count(session: AsyncSession, survey_id: uuid.UUID) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(SurveyAudience)
        .where(SurveyAudience.survey_id == survey_id)
    )
    return count or 0


async def audience_member(
    session: AsyncSession, survey_id: uuid.UUID, employee_id: str
) -> SurveyAudience | None:
    return await session.get(SurveyAudience, (survey_id, employee_id))


def _replace_allowed(survey: Survey) -> None:
    if survey.current_version_id is not None:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="The list can't be replaced after publishing. Add people with Append instead.",
        )


async def create_preview(
    session: AsyncSession,
    access: SurveyAccess,
    *,
    uploaded_by: str,
    filename: str,
    data: bytes,
    mode: Mode,
) -> AudienceUpload:
    survey = access.survey
    if mode == "replace":
        _replace_allowed(survey)
        existing: list[str] = []
    else:
        existing = list(
            (
                await session.scalars(
                    select(SurveyAudience.employee_id).where(SurveyAudience.survey_id == survey.id)
                )
            ).all()
        )
    try:
        result = parse_audience_file(data, filename, existing)
    except AudienceFileError as exc:
        raise AppError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_FAILED",
            message=str(exc),
            details={"issues": [{"field": "file", "message": str(exc)}]},
        ) from exc

    upload = AudienceUpload(
        id=uuid.uuid4(),
        survey_id=survey.id,
        file_name=filename[:200],
        mode=mode,
        status="preview",
        valid_count=len(result.rows),
        duplicate_count=result.duplicate_count,
        error_count=len(result.errors),
        rows=[row.as_dict() for row in result.rows],
        errors=result.errors,
        uploaded_by=uploaded_by,
    )
    session.add(upload)
    await session.commit()
    await session.refresh(upload)
    return upload


async def get_upload(
    session: AsyncSession, survey_id: uuid.UUID, upload_id: uuid.UUID
) -> AudienceUpload:
    upload = await session.get(AudienceUpload, upload_id)
    if upload is None or upload.survey_id != survey_id:
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="That upload wasn't found.")
    return upload


def _pending(upload: AudienceUpload) -> None:
    if upload.status != "preview":
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message=(
                f"This upload was already {upload.status}. Upload the file again to make changes."
            ),
        )


async def apply_upload(session: AsyncSession, access: SurveyAccess, upload: AudienceUpload) -> int:
    """Add the previewed rows. Returns the audience size afterwards."""
    _pending(upload)
    survey_id = access.survey.id
    if upload.mode == "replace":
        _replace_allowed(access.survey)
        await session.execute(delete(SurveyAudience).where(SurveyAudience.survey_id == survey_id))
    rows: list[dict[str, Any]] = [
        {**row, "survey_id": survey_id, "source": "upload", "upload_id": upload.id}
        for row in upload.rows
    ]
    for start in range(0, len(rows), _INSERT_BATCH):
        batch = rows[start : start + _INSERT_BATCH]
        # Someone added in the meantime (another upload) is simply kept.
        await session.execute(insert(SurveyAudience).values(batch).on_conflict_do_nothing())
    await session.execute(
        update(AudienceUpload)
        .where(AudienceUpload.id == upload.id)
        .values(status="applied", rows=[])  # the rows now live in survey_audience
    )
    await session.commit()
    return await audience_count(session, survey_id)


async def discard_upload(session: AsyncSession, upload: AudienceUpload) -> None:
    _pending(upload)
    await session.execute(
        update(AudienceUpload)
        .where(AudienceUpload.id == upload.id)
        .values(status="discarded", rows=[])
    )
    await session.commit()


@dataclass(frozen=True, slots=True)
class AudiencePage:
    total: int
    matching: int
    items: list[dict[str, Any]]
    departments: list[dict[str, Any]]


async def list_audience(
    session: AsyncSession,
    survey_id: uuid.UUID,
    *,
    search: str | None,
    department: str | None,
    page: int,
) -> AudiencePage:
    responded = (
        select(SurveyParticipation.employee_id)
        .where(
            SurveyParticipation.survey_id == survey_id,
            SurveyParticipation.employee_id == SurveyAudience.employee_id,
            SurveyParticipation.status == "submitted",
        )
        .exists()
    )
    query = select(SurveyAudience, responded.label("responded")).where(
        SurveyAudience.survey_id == survey_id
    )
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(
            or_(
                SurveyAudience.employee_id.ilike(pattern),
                SurveyAudience.name.ilike(pattern),
                SurveyAudience.email.ilike(pattern),
            )
        )
    if department is not None:
        query = query.where(
            SurveyAudience.department.is_(None)
            if department == ""
            else SurveyAudience.department == department
        )
    matching = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.execute(
        query.order_by(SurveyAudience.employee_id).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)
    )
    items = [
        {
            "employee_id": member.employee_id,
            "name": member.name,
            "email": member.email,
            "department": member.department,
            "location": member.location,
            "added_at": member.added_at,
            "responded": bool(row_responded),
        }
        for member, row_responded in rows.all()
    ]
    department_rows = await session.execute(
        select(SurveyAudience.department, func.count())
        .where(SurveyAudience.survey_id == survey_id)
        .group_by(SurveyAudience.department)
        .order_by(func.count().desc(), SurveyAudience.department)
    )
    departments: list[dict[str, Any]] = [
        {"department": name, "count": count} for name, count in department_rows.all()
    ]
    total = sum(int(d["count"]) for d in departments)
    return AudiencePage(total=total, matching=matching, items=items, departments=departments)


async def remove_member(session: AsyncSession, survey_id: uuid.UUID, employee_id: str) -> None:
    member = await audience_member(session, survey_id, employee_id)
    if member is None:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND, message="That person isn't in the audience."
        )
    submitted = await session.scalar(
        select(SurveyParticipation.status).where(
            SurveyParticipation.survey_id == survey_id,
            SurveyParticipation.employee_id == employee_id,
            SurveyParticipation.status == "submitted",
        )
    )
    if submitted:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="They've already responded, so they can't be removed.",
        )
    await session.delete(member)
    await session.commit()


async def set_open_to_all(session: AsyncSession, survey_id: uuid.UUID, open_to_all: bool) -> None:
    await session.execute(
        update(Survey)
        .where(Survey.id == survey_id)
        .values(open_to_all=open_to_all, updated_at=func.clock_timestamp())
    )
    await session.commit()
