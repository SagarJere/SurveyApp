"""Survey drafts for HR and admins (docs/04-api.md, "Surveys")."""

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import func, select

from app.auth.deps import CurrentUser, HrUser
from app.config import Settings
from app.db import SessionDep
from app.errors import ErrorResponse
from app.models import (
    Survey,
    SurveyAudience,
    SurveyParticipation,
    SurveyResponse,
    SurveyVersion,
)
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
from app.services.respond import close_if_expired, today

router = APIRouter(prefix="/surveys", tags=["surveys"])

_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
}


def _date(value: object) -> date | None:
    return date.fromisoformat(value) if isinstance(value, str) and value else None


@dataclass(frozen=True, slots=True)
class _Counts:
    version_no: int | None = None
    responses: int = 0
    this_week: int = 0
    audience: int = 0
    respondents: int = 0
    closes_at: date | None = None
    opens_at: date | None = None


def _list_item(access: service.SurveyAccess, counts: _Counts) -> SurveyListItem:
    survey = access.survey
    settings = survey.draft.get("settings", {})
    audience = 0 if survey.open_to_all else counts.audience
    published = survey.current_version_id is not None
    return SurveyListItem(
        id=survey.id,
        title=survey.title,
        status=survey.status,  # type: ignore[arg-type]
        version_no=counts.version_no,
        response_count=counts.responses,
        responses_this_week=counts.this_week,
        audience_count=audience,
        response_rate=round(counts.respondents / audience, 4) if audience else None,
        # Published surveys run on the published dates; drafts show what's being planned.
        opens_at=counts.opens_at if published else _date(settings.get("opens_at")),
        closes_at=counts.closes_at if published else _date(settings.get("closes_at")),
        has_unpublished_changes=survey.has_unpublished_changes,
        my_role=access.member_role,  # type: ignore[arg-type]
        can_edit=access.can_edit,
        can_delete=access.can_delete,
        open_to_all=survey.open_to_all,
        updated_at=survey.updated_at,
    )


async def _list_counts(
    session: SessionDep, settings: Settings, survey_ids: list[UUID]
) -> dict[UUID, _Counts]:
    if not survey_ids:
        return {}
    week_ago = today(settings) - timedelta(days=6)
    local_day = func.date(func.timezone(settings.survey_timezone, SurveyResponse.submitted_at))
    responses = dict(
        (
            await session.execute(
                select(SurveyResponse.survey_id, func.count())
                .where(SurveyResponse.survey_id.in_(survey_ids))
                .group_by(SurveyResponse.survey_id)
            )
        ).all()
    )
    this_week = dict(
        (
            await session.execute(
                select(SurveyResponse.survey_id, func.count())
                .where(SurveyResponse.survey_id.in_(survey_ids), local_day >= week_ago)
                .group_by(SurveyResponse.survey_id)
            )
        ).all()
    )
    audience = dict(
        (
            await session.execute(
                select(SurveyAudience.survey_id, func.count())
                .where(SurveyAudience.survey_id.in_(survey_ids))
                .group_by(SurveyAudience.survey_id)
            )
        ).all()
    )
    respondents = dict(
        (
            await session.execute(
                select(SurveyParticipation.survey_id, func.count())
                .where(
                    SurveyParticipation.survey_id.in_(survey_ids),
                    SurveyParticipation.status == "submitted",
                )
                .group_by(SurveyParticipation.survey_id)
            )
        ).all()
    )
    versions = {
        row.survey_id: row
        for row in (
            await session.execute(
                select(
                    Survey.id.label("survey_id"), SurveyVersion.version_no, SurveyVersion.settings
                )
                .join(SurveyVersion, SurveyVersion.id == Survey.current_version_id)
                .where(Survey.id.in_(survey_ids))
            )
        ).all()
    }
    out: dict[UUID, _Counts] = {}
    for survey_id in survey_ids:
        version = versions.get(survey_id)
        out[survey_id] = _Counts(
            version_no=version.version_no if version else None,
            responses=responses.get(survey_id, 0),
            this_week=this_week.get(survey_id, 0),
            audience=audience.get(survey_id, 0),
            respondents=respondents.get(survey_id, 0),
            opens_at=_date(version.settings.get("opens_at")) if version else None,
            closes_at=_date(version.settings.get("closes_at")) if version else None,
        )
    return out


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
async def list_surveys(request: Request, user: HrUser, session: SessionDep) -> list[SurveyListItem]:
    settings: Settings = request.app.state.settings
    accesses = await service.list_surveys(session, user)
    for access in accesses:  # surveys past their close date close themselves
        if access.survey.current_version_id is not None and access.survey.status == "published":
            version = await session.get(SurveyVersion, access.survey.current_version_id)
            if version is not None:
                await close_if_expired(session, settings, access.survey, version.settings)
    counts = await _list_counts(session, settings, [a.survey.id for a in accesses])
    return [_list_item(access, counts[access.survey.id]) for access in accesses]


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
