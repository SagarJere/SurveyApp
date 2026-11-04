"""Theme images (docs/04-api.md, "Theme assets")."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.auth.deps import CurrentUser, HrUser
from app.config import Settings
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.models import ThemeAsset
from app.schemas.theme import ThemeAssetOut
from app.services import surveys as survey_service
from app.services.images import MAX_UPLOAD_BYTES, ImageError
from app.services.storage import LocalFileStorage
from app.services.theme_assets import (
    Variant,
    check_signature,
    create_upload,
    list_gallery,
    list_uploads,
    with_links,
)

router = APIRouter(tags=["theme"])

MAX_UPLOADS_PER_SURVEY = 50


def _out(request: Request, assets: list[ThemeAsset]) -> list[ThemeAssetOut]:
    settings: Settings = request.app.state.settings
    return [
        ThemeAssetOut(
            id=link.asset.id,
            kind=link.asset.kind,  # type: ignore[arg-type]
            name=link.asset.name,
            width=link.asset.width,
            height=link.asset.height,
            url=link.url,
            mobile_url=link.mobile_url,
        )
        for link in with_links(settings, assets)
    ]


@router.get("/theme-assets/gallery", response_model=list[ThemeAssetOut])
async def gallery(request: Request, _: HrUser, session: SessionDep) -> list[ThemeAssetOut]:
    return _out(request, await list_gallery(session))


@router.get("/surveys/{survey_id}/theme-assets", response_model=list[ThemeAssetOut])
async def survey_uploads(
    survey_id: UUID, request: Request, user: CurrentUser, session: SessionDep
) -> list[ThemeAssetOut]:
    await survey_service.get_access(session, user, survey_id, "view")
    return _out(request, await list_uploads(session, survey_id))


@router.post(
    "/surveys/{survey_id}/theme-assets",
    response_model=ThemeAssetOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_413_CONTENT_TOO_LARGE: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
    },
    summary="Upload a cover or background image (JPG, PNG or WebP, up to 2 MB)",
)
async def upload(
    survey_id: UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    file: Annotated[UploadFile, File(description="JPG, PNG or WebP, up to 2 MB")],
) -> ThemeAssetOut:
    await survey_service.get_access(session, user, survey_id, "edit")
    count = await session.scalar(
        select(func.count()).select_from(ThemeAsset).where(ThemeAsset.survey_id == survey_id)
    )
    if (count or 0) >= MAX_UPLOADS_PER_SURVEY:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message=f"This survey already has {MAX_UPLOADS_PER_SURVEY} uploaded images.",
        )

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        size = file.size or len(data)
        raise AppError(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            message=f"That image is {size / (1024 * 1024):.1f} MB. Use one under 2 MB.",
        )
    storage: LocalFileStorage = request.app.state.storage
    try:
        asset = await create_upload(
            session,
            storage,
            survey_id=survey_id,
            uploaded_by=user.employee_id,
            filename=file.filename,
            data=data,
        )
    except ImageError as exc:
        raise AppError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_FAILED",
            message=str(exc),
            details={"issues": [{"field": "file", "message": str(exc)}]},
        ) from exc
    return _out(request, [asset])[0]


async def _serve(
    request: Request, session: SessionDep, *, asset_id: UUID, variant: Variant, exp: int, sig: str
) -> FileResponse:
    settings: Settings = request.app.state.settings
    if not check_signature(settings, asset_id, variant, exp, sig):
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            message="This image link has expired. Reload the page.",
        )
    asset = await session.get(ThemeAsset, asset_id)
    storage: LocalFileStorage = request.app.state.storage
    relative = None if asset is None else (asset.mobile_path if variant == "mobile" else asset.path)
    if relative is None or not storage.exists(relative):
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="Image not found.")
    return FileResponse(
        storage.path(relative),
        media_type="image/webp",
        headers={
            # The link itself expires; until then the bytes never change.
            "Cache-Control": "private, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


SigQuery = Annotated[str, Query(min_length=64, max_length=64, pattern="^[0-9a-f]+$")]


@router.get("/files/{asset_id}", response_class=FileResponse, summary="Theme image (signed link)")
async def file_full(
    asset_id: UUID, exp: int, sig: SigQuery, request: Request, session: SessionDep
) -> FileResponse:
    return await _serve(request, session, asset_id=asset_id, variant="full", exp=exp, sig=sig)


@router.get("/files/{asset_id}/mobile", response_class=FileResponse, summary="Mobile copy (signed)")
async def file_mobile(
    asset_id: UUID, exp: int, sig: SigQuery, request: Request, session: SessionDep
) -> FileResponse:
    return await _serve(request, session, asset_id=asset_id, variant="mobile", exp=exp, sig=sig)
