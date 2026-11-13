"""Taking surveys (docs/04-api.md, "Respondent"). Any signed-in employee; access is checked
per survey (audience, dates) on every call."""

from dataclasses import asdict
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request, status

from app.auth.deps import CurrentUser
from app.config import Settings
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.models import ThemeAsset, VideoAsset
from app.schemas.respond import (
    AnswersBody,
    AssetLinks,
    AttemptResult,
    DraftSaved,
    MySurvey,
    Participation,
    RespondentSurvey,
    SectionVideo,
    SubmitResult,
    TrainingInfo,
    VideoProgress,
)
from app.schemas.videos import VideoProgressIn, VideoProgressOut
from app.services import respond as service
from app.services import videos as video_service
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


async def _section_videos(
    request: Request, session: SessionDep, sections: list[dict[str, Any]]
) -> dict[str, SectionVideo]:
    """Playable links for a training's section videos (uploads get signed links)."""
    settings: Settings = request.app.state.settings
    out: dict[str, SectionVideo] = {}
    for section in sections:
        video = section.get("video")
        if not video:
            continue
        url: str | None = None
        duration: int | None = None
        if video.get("source") == "upload" and video.get("asset_id"):
            asset = await session.get(VideoAsset, UUID(video["asset_id"]))
            if asset is not None:
                url = video_service.signed_path(settings, asset.id)
                duration = asset.duration_seconds
        elif video.get("source") == "link":
            url = video.get("url")
        if url:
            out[section["key"]] = SectionVideo(
                url=url,
                allow_seek=bool(video.get("allow_seek")),
                allow_speed=bool(video.get("allow_speed")),
                duration_seconds=duration,
            )
    return out


@router.get(
    "/me/surveys", response_model=list[MySurvey], summary="Surveys you can take or have taken"
)
async def my_surveys(request: Request, user: CurrentUser, session: SessionDep) -> list[MySurvey]:
    return await _mine(request, user, session, "survey")


@router.get(
    "/me/trainings",
    response_model=list[MySurvey],
    summary="Trainings you can take or have taken",
)
async def my_trainings(request: Request, user: CurrentUser, session: SessionDep) -> list[MySurvey]:
    return await _mine(request, user, session, "training")


async def _mine(
    request: Request, user: CurrentUser, session: SessionDep, kind: Literal["survey", "training"]
) -> list[MySurvey]:
    settings: Settings = request.app.state.settings
    items = await service.my_surveys(session, settings, user, kind)
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
    training = view.context.survey.kind == "training"
    progress = (
        await video_service.progress_for(session, survey_id, user.employee_id) if training else {}
    )
    return RespondentSurvey(
        survey_id=survey_id,
        kind="training" if training else "survey",
        version_no=view.context.version.version.version_no,
        title=content["title"],
        description=content["description"],
        # Quiz rules go out through `training`, with only what the person may see.
        settings={k: v for k, v in content["settings"].items() if k != "quiz"},
        theme=content["theme"],
        # The section's raw video settings stay on the server; `videos` has what's playable.
        sections=[{k: v for k, v in s.items() if k != "video"} for s in content["sections"]],
        questions=content["questions"],
        assets=await _assets(request, session, content["theme"]),
        videos=await _section_videos(request, session, content["sections"]) if training else {},
        video_progress={
            key: VideoProgress(furthest_seconds=p.furthest_seconds, completed=p.completed)
            for key, p in progress.items()
        },
        training=TrainingInfo.model_validate(
            asdict(await service.training_info(session, view.context))
        )
        if training
        else None,
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
    summary="Submit answers (one transaction: response, answers, shown questions, participation)."
    " Trainings: scored on the server; 409 when no attempts are left",
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
        training=AttemptResult.model_validate(asdict(result.training)) if result.training else None,
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


MAX_VIDEO_SECONDS = 24 * 3600


@router.put(
    "/respond/{survey_id}/videos/{section_key}",
    response_model=VideoProgressOut,
    responses={**_ERRORS, status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
    summary="Record how far you got in a section's video, and when you finish it",
)
async def video_progress(
    *,
    survey_id: UUID,
    section_key: UUID,
    body: VideoProgressIn,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
) -> VideoProgressOut:
    settings: Settings = request.app.state.settings
    context = await service.respondent_context(session, settings, user, survey_id)
    sections = context.version.content["sections"]
    if context.survey.kind != "training" or not any(
        s["key"] == str(section_key) and s.get("video") for s in sections
    ):
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="That video isn't here.")
    saved = await video_service.record_progress(
        session,
        survey_id=survey_id,
        employee_id=user.employee_id,
        section_key=section_key,
        furthest_seconds=max(0, min(body.furthest_seconds, MAX_VIDEO_SECONDS)),
        completed=body.completed,
    )
    return VideoProgressOut(furthest_seconds=saved.furthest_seconds, completed=saved.completed)
