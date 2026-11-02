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
from app.schemas.draft import Draft, Section

Need = Literal["view", "edit", "own"]
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


async def list_surveys(session: AsyncSession, user: AuthenticatedUser) -> list[SurveyAccess]:
    """Surveys the user is a member of; admins see every survey. Newest activity first."""
    query = select(Survey, SurveyMember.role).outerjoin(
        SurveyMember,
        (SurveyMember.survey_id == Survey.id) & (SurveyMember.employee_id == user.employee_id),
    )
    if not user.is_admin:
        query = query.where(SurveyMember.employee_id.is_not(None))
    rows = await session.execute(query.order_by(Survey.updated_at.desc(), Survey.id))
    return [_access(row[0], row[1], user) for row in rows.all()]


async def _insert(session: AsyncSession, user: AuthenticatedUser, draft: Draft) -> Survey:
    survey = Survey(
        title=draft.title,
        draft=draft.model_dump(mode="json"),
        created_by=user.employee_id,
    )
    session.add(survey)
    await session.flush()
    session.add(SurveyMember(survey_id=survey.id, employee_id=user.employee_id, role="owner"))
    await session.commit()
    await session.refresh(survey)
    return survey


async def create_survey(session: AsyncSession, user: AuthenticatedUser) -> SurveyAccess:
    survey = await _insert(session, user, new_draft())
    return _access(survey, "owner", user)


async def save_draft(
    session: AsyncSession, access: SurveyAccess, draft: Draft, expected_updated_at: datetime
) -> datetime:
    """Replace the draft, unless someone else saved since `expected_updated_at` (then 409)."""
    survey = access.survey
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
    session: AsyncSession, user: AuthenticatedUser, access: SurveyAccess
) -> SurveyAccess:
    source = Draft.model_validate(access.survey.draft)
    copy = _rekey(source)
    copy.title = f"{source.title} (copy)" if source.title.strip() else ""
    copy.title = copy.title[:300]
    survey = await _insert(session, user, copy)
    return _access(survey, "owner", user)


async def delete_survey(session: AsyncSession, access: SurveyAccess) -> None:
    if access.survey.current_version_id is not None:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="Published surveys can't be deleted. Close the survey instead.",
        )
    await session.delete(access.survey)
    await session.commit()
