"""Training videos (docs/04-api.md, "Training videos")."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.auth.deps import CurrentUser
from app.config import Settings
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.models import VideoAsset
from app.schemas.videos import VideoOut
from app.services import surveys as survey_service
from app.services import videos as service
from app.services.storage import LocalFileStorage

router = APIRouter(tags=["videos"])

_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
    status.HTTP_409_CONFLICT: {"model": ErrorResponse},
}


def _out(settings: Settings, asset: VideoAsset, published: set[str]) -> VideoOut:
    return VideoOut(
        id=asset.id,
        file_name=asset.file_name,
        content_type=asset.content_type,
        size_bytes=asset.size_bytes,
        duration_seconds=asset.duration_seconds,
        url=service.signed_path(settings, asset.id),
        published=str(asset.id) in published,
    )


async def _training(session: SessionDep, user: CurrentUser, survey_id: UUID, need: str) -> None:
    access = await survey_service.get_access(session, user, survey_id, need)  # type: ignore[arg-type]
    if access.survey.kind != "training":
        raise AppError(
            status_code=status.HTTP_409_CONFLICT, message="Only trainings can have videos."
        )


@router.get("/surveys/{survey_id}/videos", response_model=list[VideoOut], responses=_ERRORS)
async def list_videos(
    survey_id: UUID, request: Request, user: CurrentUser, session: SessionDep
) -> list[VideoOut]:
    await _training(session, user, survey_id, "view")
    settings: Settings = request.app.state.settings
    published = await service.published_video_ids(session, survey_id)
    return [_out(settings, a, published) for a in await service.list_videos(session, survey_id)]


@router.post(
    "/surveys/{survey_id}/videos",
    response_model=VideoOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        **_ERRORS,
        status.HTTP_413_CONTENT_TOO_LARGE: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
    summary="Upload a training video (MP4 or WebM, up to VIDEO_MAX_MB)",
)
async def upload_video(
    *,
    survey_id: UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    file: Annotated[UploadFile, File(description="MP4 or WebM")],
    duration_seconds: Annotated[int | None, Form(ge=0, le=24 * 3600)] = None,
) -> VideoOut:
    await _training(session, user, survey_id, "edit")
    count = await session.scalar(
        select(func.count()).select_from(VideoAsset).where(VideoAsset.survey_id == survey_id)
    )
    if (count or 0) >= service.MAX_VIDEOS_PER_SURVEY:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message=f"This training already has {service.MAX_VIDEOS_PER_SURVEY} uploaded videos.",
        )
    settings: Settings = request.app.state.settings
    storage: LocalFileStorage = request.app.state.storage
    try:
        asset = await service.create_video(
            session,
            storage,
            settings,
            survey_id=survey_id,
            uploaded_by=user.employee_id,
            filename=file.filename,
            source=file.file,
            size=file.size or 0,
            duration_seconds=duration_seconds,
        )
    except service.VideoTooLarge as exc:
        raise AppError(status_code=status.HTTP_413_CONTENT_TOO_LARGE, message=str(exc)) from exc
    except service.VideoError as exc:
        raise AppError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_FAILED",
            message=str(exc),
            details={"issues": [{"field": "file", "message": str(exc)}]},
        ) from exc
    return _out(settings, asset, set())


@router.delete(
    "/surveys/{survey_id}/videos/{video_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_ERRORS,
    summary="Delete an uploaded video that no published version uses",
)
async def delete_video(
    survey_id: UUID, video_id: UUID, request: Request, user: CurrentUser, session: SessionDep
) -> Response:
    await _training(session, user, survey_id, "edit")
    asset = await session.get(VideoAsset, video_id)
    if asset is None or asset.survey_id != survey_id:
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="Video not found.")
    if str(video_id) in await service.published_video_ids(session, survey_id):
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="A published version uses this video, so it can't be deleted.",
        )
    storage: LocalFileStorage = request.app.state.storage
    await service.delete_video(session, storage, asset)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


SigQuery = Annotated[str, Query(min_length=64, max_length=64, pattern="^[0-9a-f]+$")]


@router.get(
    "/files/videos/{video_id}",
    response_class=FileResponse,
    summary="Training video (signed link; supports range requests)",
)
async def stream_video(
    video_id: UUID, exp: int, sig: SigQuery, request: Request, session: SessionDep
) -> FileResponse:
    settings: Settings = request.app.state.settings
    if not service.check_signature(settings, video_id, exp, sig):
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            message="This video link has expired. Reload the page.",
        )
    asset = await session.get(VideoAsset, video_id)
    storage: LocalFileStorage = request.app.state.storage
    if asset is None or not storage.exists(asset.path):
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="Video not found.")
    # FileResponse streams the file in chunks and answers Range requests with 206.
    return FileResponse(
        storage.path(asset.path),
        media_type=asset.content_type,
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
