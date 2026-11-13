"""Survey drafts: create, list, read, save (with conflict detection), duplicate, delete.

Access rules (docs/01-requirements.md, Roles):
- Owners and co-owners edit. Viewers only see results. Only owners delete.
- Admins can do everything HR can, on every survey.
- People who aren't members get 404, so survey IDs don't reveal that a survey exists.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthenticatedUser
from app.errors import AppError
from app.models import Survey, SurveyMember
from app.schemas.draft import Draft, QuizSettings, Section
from app.services import videos
from app.services.storage import LocalFileStorage

Need = Literal["view", "edit", "own"]
SurveyKind = Literal["survey", "training"]
_EDIT_ROLES = frozenset({"owner", "coowner"})


@dataclass(frozen=True, slots=True)
class SurveyAccess:
    survey: Survey
    member_role: str | None  # None for admins who aren't members
    can_edit: bool
    can_own: bool

    @property
    def can_delete(self) -> bool:
        return self.can_own and self.survey.current_version_id is None


def new_draft() -> Draft:
    """An empty survey: one untitled section and no questions."""
    return Draft(sections=[Section(key=uuid.uuid4())])


def _access(survey: Survey, role: str | None, user: AuthenticatedUser) -> SurveyAccess:
    return SurveyAccess(
        survey=survey,
        member_role=role,
        can_edit=user.is_admin or role in _EDIT_ROLES,
        can_own=user.is_admin or role == "owner",
    )


def _not_found() -> AppError:
    return AppError(status_code=status.HTTP_404_NOT_FOUND, message="We couldn't find that survey.")


async def get_access(
    session: AsyncSession, user: AuthenticatedUser, survey_id: uuid.UUID, need: Need = "view"
) -> SurveyAccess:
    row = (
        await session.execute(
            select(Survey, SurveyMember.role)
            .outerjoin(
                SurveyMember,
                (SurveyMember.survey_id == Survey.id)
                & (SurveyMember.employee_id == user.employee_id),
            )
            .where(Survey.id == survey_id)
        )
    ).one_or_none()
    if row is None:
        raise _not_found()
    survey: Survey = row[0]
    role: str | None = row[1]  # None when not a member (outer join)
    if role is None and not user.is_admin:
        raise _not_found()
    access = _access(survey, role, user)
    if need == "edit" and not access.can_edit:
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            message="You can view this survey but not edit it.",
        )
    if need == "own" and not access.can_own:
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            message="Only the survey's owner can do this.",
        )
    return access


async def list_surveys(
    session: AsyncSession, user: AuthenticatedUser, kind: SurveyKind = "survey"
) -> list[SurveyAccess]:
    """Surveys (or trainings) the user is a member of; admins see all. Newest activity first."""
    query = (
        select(Survey, SurveyMember.role)
        .outerjoin(
            SurveyMember,
            (SurveyMember.survey_id == Survey.id) & (SurveyMember.employee_id == user.employee_id),
        )
        .where(Survey.kind == kind)
    )
    if not user.is_admin:
        query = query.where(SurveyMember.employee_id.is_not(None))
    rows = await session.execute(query.order_by(Survey.updated_at.desc(), Survey.id))
    return [_access(row[0], row[1], user) for row in rows.all()]


async def _insert(
    session: AsyncSession,
    user: AuthenticatedUser,
    draft: Draft,
    kind: SurveyKind = "survey",
    *,
    commit: bool = True,
) -> Survey:
    survey = Survey(
        title=draft.title,
        kind=kind,
        draft=apply_kind_rules(kind, draft).model_dump(mode="json"),
        created_by=user.employee_id,
    )
    session.add(survey)
    await session.flush()
    session.add(SurveyMember(survey_id=survey.id, employee_id=user.employee_id, role="owner"))
    if commit:
        await session.commit()
        await session.refresh(survey)
    return survey


def apply_kind_rules(kind: str, draft: Draft) -> Draft:
    """Trainings are never anonymous and can't be edited after submitting (scores would
    change), and always have quiz settings. Only trainings have videos, correct answers and a
    due date (docs/09-trainings.md)."""
    if kind == "training":
        draft.settings.anonymous = False
        draft.settings.allow_edit = False
        if draft.settings.quiz is None:
            draft.settings.quiz = QuizSettings()
        return draft
    draft.settings.quiz = None
    draft.settings.due_date = None
    for field, message, found in (
        ("sections", "Only trainings can have videos.", any(s.video for s in draft.sections)),
        (
            "questions",
            "Only trainings can have correct answers.",
            any(q.quiz for q in draft.questions),
        ),
    ):
        if found:
            raise AppError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_FAILED",
                message=message,
                details={"issues": [{"field": field, "message": message}]},
            )
    return draft


async def create_survey(
    session: AsyncSession, user: AuthenticatedUser, kind: SurveyKind = "survey"
) -> SurveyAccess:
    survey = await _insert(session, user, new_draft(), kind)
    return _access(survey, "owner", user)


async def save_draft(
    session: AsyncSession, access: SurveyAccess, draft: Draft, expected_updated_at: datetime
) -> datetime:
    """Replace the draft, unless someone else saved since `expected_updated_at` (then 409)."""
    survey = access.survey
    draft = apply_kind_rules(survey.kind, draft)
    result = await session.execute(
        update(Survey)
        .where(Survey.id == survey.id, Survey.draft_updated_at == expected_updated_at)
        .values(
            draft=draft.model_dump(mode="json"),
            title=draft.title,
            draft_updated_at=func.clock_timestamp(),
            updated_at=func.clock_timestamp(),
            has_unpublished_changes=Survey.current_version_id.is_not(None),
        )
        .returning(Survey.draft_updated_at)
    )
    saved = result.scalar_one_or_none()
    if saved is None:
        await session.rollback()
        await session.refresh(survey)
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="DRAFT_CONFLICT",
            message="Someone else edited this survey. Reload to see their changes.",
            details={"draft_updated_at": survey.draft_updated_at.isoformat()},
        )
    await session.commit()
    return saved


def _rekey(draft: Draft) -> Draft:
    """Copy of the draft with fresh keys everywhere, conditions pointing at the new keys."""
    data: dict[str, Any] = draft.model_dump(mode="json")
    new_keys: dict[str, str] = {}

    def fresh(old: str) -> str:
        new_keys[old] = str(uuid.uuid4())
        return new_keys[old]

    for section in data["sections"]:
        section["key"] = fresh(section["key"])
    for question in data["questions"]:
        question["key"] = fresh(question["key"])
        question["section_key"] = new_keys[question["section_key"]]
        for option in question["options"]:
            option["key"] = fresh(option["key"])
    for item in [*data["sections"], *data["questions"]]:
        condition = item.get("condition")
        if condition:
            # Broken conditions keep pointing at keys that don't exist; still broken in the copy.
            condition["src"] = new_keys.get(condition["src"], condition["src"])
            if isinstance(condition["val"], str):
                condition["val"] = new_keys.get(condition["val"], condition["val"])
    return Draft.model_validate(data)


async def duplicate_survey(
    session: AsyncSession,
    user: AuthenticatedUser,
    access: SurveyAccess,
    storage: LocalFileStorage,
) -> SurveyAccess:
    """A new draft you own, with fresh keys. A training's uploaded videos are copied too, so
    the copy keeps working if the original is deleted."""
    source = Draft.model_validate(access.survey.draft)
    copy = _rekey(source)
    copy.title = f"{source.title} (copy)" if source.title.strip() else ""
    copy.title = copy.title[:300]
    kind = access.survey.kind
    survey = await _insert(session, user, copy, kind, commit=False)  # type: ignore[arg-type]
    if kind == "training":
        mapping = await videos.copy_videos(
            session,
            storage,
            from_survey=access.survey.id,
            to_survey=survey.id,
            uploaded_by=user.employee_id,
        )
        for section in copy.sections:
            video = section.video
            if video is not None and video.asset_id is not None:
                new_id = mapping.get(str(video.asset_id))
                video.asset_id = uuid.UUID(new_id) if new_id else None
        survey.draft = copy.model_dump(mode="json")
    await session.commit()
    await session.refresh(survey)
    return _access(survey, "owner", user)


async def delete_survey(
    session: AsyncSession, access: SurveyAccess, storage: LocalFileStorage
) -> None:
    if access.survey.current_version_id is not None:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="Published surveys can't be deleted. Close the survey instead.",
        )
    uploaded = await videos.list_videos(session, access.survey.id)
    await session.delete(access.survey)
    await session.commit()
    videos.delete_files(storage, uploaded)  # rows went with the survey; now the files
