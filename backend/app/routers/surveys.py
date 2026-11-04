"""Survey drafts for HR and admins (docs/04-api.md, "Surveys")."""

from dataclasses import asdict
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Response, status
from sqlalchemy import select

from app.auth.deps import CurrentUser, HrUser
from app.db import SessionDep
from app.errors import ErrorResponse
from app.models import SurveyVersion
from app.schemas.draft import Draft
from app.schemas.surveys import (
    CloseResponse,
    IssueOut,
    PublishResponse,
    SaveDraftRequest,
    SaveDraftResponse,
    SurveyDetail,
    SurveyListItem,
    ValidateResponse,
)
from app.services import publish as publishing
from app.services import surveys as service

router = APIRouter(prefix="/surveys", tags=["surveys"])

_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
}


def _date(value: object) -> date | None:
    return date.fromisoformat(value) if isinstance(value, str) and value else None


def _list_item(access: service.SurveyAccess, version_no: int | None) -> SurveyListItem:
    survey = access.survey
    settings = survey.draft.get("settings", {})
    return SurveyListItem(
        id=survey.id,
        title=survey.title,
        status=survey.status,  # type: ignore[arg-type]
        version_no=version_no,
        # Audiences and responses arrive in later phases; until then there are none.
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


def _detail(access: service.SurveyAccess, version_no: int | None) -> SurveyDetail:
    survey = access.survey
    return SurveyDetail(
        id=survey.id,
        title=survey.title,
        status=survey.status,  # type: ignore[arg-type]
        version_no=version_no,
        draft=Draft.model_validate(survey.draft),
        draft_updated_at=survey.draft_updated_at,
        has_unpublished_changes=survey.has_unpublished_changes,
        open_to_all=survey.open_to_all,
        my_role=access.member_role,  # type: ignore[arg-type]
        can_edit=access.can_edit,
        can_delete=access.can_delete,
        closed_at=survey.closed_at,
        created_at=survey.created_at,
        updated_at=survey.updated_at,
    )


@router.get("", response_model=list[SurveyListItem], summary="Surveys you can see")
async def list_surveys(user: HrUser, session: SessionDep) -> list[SurveyListItem]:
    accesses = await service.list_surveys(session, user)
    version_ids = [a.survey.current_version_id for a in accesses if a.survey.current_version_id]
    numbers: dict[UUID, int] = {}
    if version_ids:
        rows = await session.execute(
            select(SurveyVersion.id, SurveyVersion.version_no).where(
                SurveyVersion.id.in_(version_ids)
            )
        )
        numbers = {row[0]: row[1] for row in rows.all()}
    return [
        _list_item(
            access,
            numbers.get(access.survey.current_version_id)
            if access.survey.current_version_id
            else None,
        )
        for access in accesses
    ]


@router.post(
    "",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create an empty draft with one section",
)
async def create_survey(user: HrUser, session: SessionDep) -> SurveyDetail:
    return _detail(await service.create_survey(session, user), None)


@router.get("/{survey_id}", response_model=SurveyDetail, responses=_ERRORS)
async def get_survey(survey_id: UUID, user: CurrentUser, session: SessionDep) -> SurveyDetail:
    access = await service.get_access(session, user, survey_id, "view")
    return _detail(access, await publishing.current_version_no(session, access.survey))


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
    issues = await publishing.publish_issues(session, access.survey)
    warnings = await publishing.publish_warnings(session, access.survey)
    return ValidateResponse(
        issues=[IssueOut(**asdict(issue)) for issue in issues],
        warnings=[IssueOut(**asdict(warning)) for warning in warnings],
    )


@router.post(
    "/{survey_id}/publish",
    response_model=PublishResponse,
    responses={
        **_ERRORS,
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
    summary="Validate the saved draft and publish it as a new version",
)
async def publish(survey_id: UUID, user: CurrentUser, session: SessionDep) -> PublishResponse:
    access = await service.get_access(session, user, survey_id, "edit")
    version = await publishing.publish(session, access, user.employee_id)
    return PublishResponse(
        status="published",
        version_no=version.version_no,
        published_at=version.published_at,
        has_unpublished_changes=False,
    )


@router.post(
    "/{survey_id}/close",
    response_model=CloseResponse,
    responses={**_ERRORS, status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
    summary="Stop accepting responses",
)
async def close(survey_id: UUID, user: CurrentUser, session: SessionDep) -> CloseResponse:
    access = await service.get_access(session, user, survey_id, "edit")
    survey = await publishing.close(session, access)
    assert survey.closed_at is not None  # noqa: S101 - set by close()
    return CloseResponse(status="closed", closed_at=survey.closed_at)


@router.post(
    "/{survey_id}/duplicate",
    response_model=SurveyDetail,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
    summary="Copy the current draft into a new survey you own",
)
async def duplicate(survey_id: UUID, user: HrUser, session: SessionDep) -> SurveyDetail:
    access = await service.get_access(session, user, survey_id, "view")
    return _detail(await service.duplicate_survey(session, user, access), None)


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
