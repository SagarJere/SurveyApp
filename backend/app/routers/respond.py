"""Taking surveys (docs/04-api.md, "Respondent"). Any signed-in employee; access is checked
per survey (audience, dates) on every call."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request, status

from app.auth.deps import CurrentUser
from app.config import Settings
from app.db import SessionDep
from app.errors import ErrorResponse
from app.models import ThemeAsset
from app.schemas.respond import (
    AnswersBody,
    AssetLinks,
    DraftSaved,
    MySurvey,
    Participation,
    RespondentSurvey,
    SubmitResult,
)
from app.services import respond as service
from app.services.theme_assets import signed_path

router = APIRouter(tags=["respond"])

_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_409_CONFLICT: {"model": ErrorResponse},
    status.HTTP_410_GONE: {"model": ErrorResponse},
}


async def _assets(
    request: Request, session: SessionDep, theme: dict[str, Any]
) -> dict[str, AssetLinks]:
    """Signed links for the theme images this version uses."""
    settings: Settings = request.app.state.settings
    links: dict[str, AssetLinks] = {}
    for asset_id in {theme.get("cover"), theme.get("background")}:
        if not isinstance(asset_id, str):
            continue
        try:
            asset = await session.get(ThemeAsset, UUID(asset_id))
        except ValueError:
            continue
        if asset is not None:
            links[asset_id] = AssetLinks(
                url=signed_path(settings, asset.id, "full"),
                mobile_url=signed_path(settings, asset.id, "mobile"),
                width=asset.width,
            )
    return links


@router.get(
    "/me/surveys", response_model=list[MySurvey], summary="Surveys you can take or have taken"
)
async def my_surveys(request: Request, user: CurrentUser, session: SessionDep) -> list[MySurvey]:
    settings: Settings = request.app.state.settings
    items = await service.my_surveys(session, settings, user)
    result: list[MySurvey] = []
    for item in items:
        theme = item.pop("theme")
        assets = await _assets(request, session, {"cover": theme.get("cover")})
        result.append(
            MySurvey(
                **item,
                accent=theme.get("accent", "#0E7A6A"),
                cover=assets.get(theme.get("cover") or ""),
            )
        )
    return result


@router.get(
    "/respond/{survey_id}",
    response_model=RespondentSurvey,
    responses=_ERRORS,
    summary="The current version to answer, plus your draft or answers",
)
async def get_survey(
    survey_id: UUID, request: Request, user: CurrentUser, session: SessionDep
) -> RespondentSurvey:
    settings: Settings = request.app.state.settings
    view = await service.respondent_view(session, settings, user, survey_id)
    content = view.context.version.content
    return RespondentSurvey(
        survey_id=survey_id,
        version_no=view.context.version.version.version_no,
        title=content["title"],
        description=content["description"],
        settings=content["settings"],
        theme=content["theme"],
        sections=content["sections"],
        questions=content["questions"],
        assets=await _assets(request, session, content["theme"]),
        participation=Participation(
            status=view.status,
            answers=view.answers,
            can_edit=view.can_edit,
            can_respond_again=view.can_respond_again,
            draft_updated=view.draft_updated,
        ),
    )


@router.put(
    "/respond/{survey_id}/draft",
    response_model=DraftSaved,
    responses=_ERRORS,
    summary="Autosave answers in progress",
)
async def save_draft(
    survey_id: UUID, body: AnswersBody, request: Request, user: CurrentUser, session: SessionDep
) -> DraftSaved:
    settings: Settings = request.app.state.settings
    saved = await service.save_draft(session, settings, user, survey_id, body.answers)
    return DraftSaved(saved_at=saved)


@router.post(
    "/respond/{survey_id}/submit",
    response_model=SubmitResult,
    responses={**_ERRORS, status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
    summary="Submit answers (one transaction: response, answers, shown questions, participation)",
)
async def submit(
    survey_id: UUID, body: AnswersBody, request: Request, user: CurrentUser, session: SessionDep
) -> SubmitResult:
    settings: Settings = request.app.state.settings
    result = await service.submit(session, settings, user, survey_id, body.answers)
    return SubmitResult(
        status="submitted",
        submitted_at=result.submitted_at,
        can_edit=result.can_edit,
        can_respond_again=result.can_respond_again,
    )


@router.get(
    "/respond/{survey_id}/my-response",
    response_model=dict[str, Any],
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
    summary="Your submitted answers (not available for anonymous surveys)",
)
async def my_response(
    survey_id: UUID, request: Request, user: CurrentUser, session: SessionDep
) -> dict[str, Any]:
    settings: Settings = request.app.state.settings
    return await service.my_response(session, settings, user, survey_id)
