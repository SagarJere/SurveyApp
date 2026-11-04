"""Survey audiences (docs/04-api.md, "Audience")."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Query, Response, UploadFile, status

from app.auth.deps import CurrentUser
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.models import AudienceUpload
from app.schemas.audience import (
    ApplyResult,
    AudienceList,
    AudienceMember,
    DepartmentCount,
    OpenToAll,
    RowToFix,
    UploadPreview,
)
from app.services import audience as service
from app.services import surveys as survey_service
from app.services.audience_import import MAX_FILE_BYTES, errors_workbook, template_workbook
from app.services.employee_ids import normalize_employee_id

router = APIRouter(prefix="/surveys/{survey_id}/audience", tags=["audience"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
    status.HTTP_409_CONFLICT: {"model": ErrorResponse},
}


def _xlsx(data: bytes, filename: str) -> Response:
    return Response(
        content=data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _preview(upload: AudienceUpload) -> UploadPreview:
    errors = upload.errors[: service.PREVIEW_ERROR_LIMIT]
    return UploadPreview(
        upload_id=upload.id,
        file_name=upload.file_name,
        mode=upload.mode,  # type: ignore[arg-type]
        status=upload.status,  # type: ignore[arg-type]
        valid_count=upload.valid_count,
        duplicate_count=upload.duplicate_count,
        error_count=upload.error_count,
        errors=[
            RowToFix(row=e["row"], employee_id=e["employee_id"], problem=e["problem"])
            for e in errors
        ],
        errors_truncated=len(upload.errors) > len(errors),
    )


@router.get("/template", response_class=Response, summary="Download audience_template.xlsx")
async def template(survey_id: UUID, user: CurrentUser, session: SessionDep) -> Response:
    await survey_service.get_access(session, user, survey_id, "view")
    return _xlsx(template_workbook(), "audience_template.xlsx")


@router.post(
    "/uploads",
    response_model=UploadPreview,
    status_code=status.HTTP_201_CREATED,
    responses={**_ERRORS, status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
    summary="Check an .xlsx or .csv file and keep a preview to apply or discard",
)
async def upload(
    survey_id: UUID,
    user: CurrentUser,
    session: SessionDep,
    file: Annotated[UploadFile, File(description=".xlsx or .csv with an EmployeeId column")],
    mode: Annotated[Literal["append", "replace"], Query()] = "append",
) -> UploadPreview:
    access = await survey_service.get_access(session, user, survey_id, "edit")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise AppError(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            message="This file is larger than 10 MB. Split it into smaller files.",
        )
    preview = await service.create_preview(
        session,
        access,
        uploaded_by=user.employee_id,
        filename=file.filename or "audience",
        data=data,
        mode=mode,
    )
    return _preview(preview)


@router.get("/uploads/{upload_id}/errors.xlsx", response_class=Response, summary="Rows to fix")
async def upload_errors(
    survey_id: UUID, upload_id: UUID, user: CurrentUser, session: SessionDep
) -> Response:
    await survey_service.get_access(session, user, survey_id, "edit")
    upload_row = await service.get_upload(session, survey_id, upload_id)
    return _xlsx(errors_workbook(upload_row.errors), "rows_to_fix.xlsx")


@router.post(
    "/uploads/{upload_id}/apply",
    response_model=ApplyResult,
    responses=_ERRORS,
    summary="Add the previewed rows to the audience",
)
async def apply(
    survey_id: UUID, upload_id: UUID, user: CurrentUser, session: SessionDep
) -> ApplyResult:
    access = await survey_service.get_access(session, user, survey_id, "edit")
    upload_row = await service.get_upload(session, survey_id, upload_id)
    return ApplyResult(audience_count=await service.apply_upload(session, access, upload_row))


@router.post(
    "/uploads/{upload_id}/discard",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_ERRORS,
    summary="Throw the preview away",
)
async def discard(
    survey_id: UUID, upload_id: UUID, user: CurrentUser, session: SessionDep
) -> Response:
    await survey_service.get_access(session, user, survey_id, "edit")
    upload_row = await service.get_upload(session, survey_id, upload_id)
    await service.discard_upload(session, upload_row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=AudienceList, responses=_ERRORS, summary="Paged audience list")
async def list_audience(
    survey_id: UUID,
    user: CurrentUser,
    session: SessionDep,
    *,
    search: Annotated[str | None, Query(max_length=100)] = None,
    department: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
) -> AudienceList:
    access = await survey_service.get_access(session, user, survey_id, "view")
    result = await service.list_audience(
        session, survey_id, search=search, department=department, page=page
    )
    return AudienceList(
        open_to_all=access.survey.open_to_all,
        total=result.total,
        matching=result.matching,
        page=page,
        page_size=service.PAGE_SIZE,
        items=[AudienceMember(**item) for item in result.items],
        departments=[DepartmentCount(**d) for d in result.departments],
        can_replace=access.survey.current_version_id is None,
    )


@router.delete(
    "/{employee_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_ERRORS,
    summary="Remove one person (not possible once they've responded)",
)
async def remove(
    survey_id: UUID, employee_id: str, user: CurrentUser, session: SessionDep
) -> Response:
    await survey_service.get_access(session, user, survey_id, "edit")
    await service.remove_member(session, survey_id, normalize_employee_id(employee_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/open-to-all", response_model=OpenToAll, responses=_ERRORS)
async def open_to_all(
    survey_id: UUID, body: OpenToAll, user: CurrentUser, session: SessionDep
) -> OpenToAll:
    await survey_service.get_access(session, user, survey_id, "edit")
    await service.set_open_to_all(session, survey_id, body.open_to_all)
    return body
