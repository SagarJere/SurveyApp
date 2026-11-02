"""Survey drafts for HR and admins (docs/04-api.md, "Surveys")."""

from dataclasses import asdict
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Response, status

from app.auth.deps import CurrentUser, HrUser
from app.db import SessionDep
from app.errors import ErrorResponse
from app.schemas.draft import Draft
from app.schemas.surveys import (
    IssueOut,
    SaveDraftRequest,
    SaveDraftResponse,
    SurveyDetail,
    SurveyListItem,
    ValidateResponse,
)
from app.services import surveys as service
from app.services.survey_logic import validate_draft

router = APIRouter(prefix="/surveys", tags=["surveys"])

_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
}


def _date(value: object) -> date | None:
    return date.fromisoformat(value) if isinstance(value, str) and value else None


def _list_item(access: service.SurveyAccess) -> SurveyListItem:
    survey = access.survey
    settings = survey.draft.get("settings", {})
    return SurveyListItem(
        id=survey.id,
        title=survey.title,
        status=survey.status,  # type: ignore[arg-type]
        # Versions, audiences and responses arrive in later phases; until then there are none.
        version_no=None,
        response_count=0,
        audience_count=0,
        response_rate=None,
        opens_at=_date(settings.get("opens_at")),
        closes_at=_date(settings.get("closes_at")),
        has_unpublished_changes=survey.has_unpublished_changes,
        my_role=access.member_role,  # type: ignore[arg-type]
        can_edit=access.can_edit,
        can_delete=access.can_delete,
        updated_at=survey.updated_at,
    )


def _detail(access: service.SurveyAccess) -> SurveyDetail:
    survey = access.survey
    return SurveyDetail(
        id=survey.id,
        title=survey.title,
        status=survey.status,  # type: ignore[arg-type]
        version_no=None,
        draft=Draft.model_validate(survey.draft),
        draft_updated_at=survey.draft_updated_at,
        has_unpublished_changes=survey.has_unpublished_changes,
        open_to_all=survey.open_to_all,
        my_role=access.member_role,  # type: ignore[arg-type]
        can_edit=access.can_edit,
        can_delete=access.can_delete,
        created_at=survey.created_at,
        updated_at=survey.updated_at,
    )


@router.get("", response_model=list[SurveyListItem], summary="Surveys you can see")
async def list_surveys(user: HrUser, session: SessionDep) -> list[SurveyListItem]:
    return [_list_item(access) for access in await service.list_surveys(session, user)]


@router.post(
    "",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create an empty draft with one section",
)
async def create_survey(user: HrUser, session: SessionDep) -> SurveyDetail:
    return _detail(await service.create_survey(session, user))


@router.get("/{survey_id}", response_model=SurveyDetail, responses=_ERRORS)
async def get_survey(survey_id: UUID, user: CurrentUser, session: SessionDep) -> SurveyDetail:
    return _detail(await service.get_access(session, user, survey_id, "view"))


@router.put(
    "/{survey_id}/draft",
    response_model=SaveDraftResponse,
    responses={**_ERRORS, status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
    summary="Save the whole draft (409 if someone else saved since you last loaded it)",
)
async def save_draft(
    survey_id: UUID, body: SaveDraftRequest, user: CurrentUser, session: SessionDep
) -> SaveDraftResponse:
    access = await service.get_access(session, user, survey_id, "edit")
    saved = await service.save_draft(session, access, body.draft, body.draft_updated_at)
    return SaveDraftResponse(draft_updated_at=saved)


@router.post(
    "/{survey_id}/validate",
    response_model=ValidateResponse,
    responses=_ERRORS,
    summary="Check the saved draft for problems that would block publishing",
)
async def validate(survey_id: UUID, user: CurrentUser, session: SessionDep) -> ValidateResponse:
    access = await service.get_access(session, user, survey_id, "edit")
    draft = Draft.model_validate(access.survey.draft)
    issues = validate_draft(draft.as_logic_dict())
    return ValidateResponse(issues=[IssueOut(**asdict(issue)) for issue in issues])


@router.post(
    "/{survey_id}/duplicate",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
    summary="Copy the current draft into a new survey you own",
)
async def duplicate(survey_id: UUID, user: HrUser, session: SessionDep) -> SurveyDetail:
    access = await service.get_access(session, user, survey_id, "view")
    return _detail(await service.duplicate_survey(session, user, access))


@router.delete(
    "/{survey_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**_ERRORS, status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
    summary="Delete a survey that was never published (owner only)",
)
async def delete(survey_id: UUID, user: CurrentUser, session: SessionDep) -> Response:
    access = await service.get_access(session, user, survey_id, "own")
    await service.delete_survey(session, access)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
