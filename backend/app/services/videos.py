"""Training videos (docs/09-trainings.md): uploads, signed streaming links, progress.

Uploaded files are checked by their first bytes (not their name), stored under
FILE_STORAGE_PATH/videos/ and served through signed, expiring links with HTTP range support
(the file endpoint checks the signature instead of a token, because <video> can't send one).
"""

import hashlib
import hmac
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePath
from typing import BinaryIO, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import SurveyVersion, VersionSection, VideoAsset, VideoView
from app.schemas.draft import Draft
from app.services.storage import LocalFileStorage
from app.services.survey_logic import Issue

VideoType = Literal["video/mp4", "video/webm"]
LINK_LIFETIME_SECONDS = 24 * 3600
_HOUR = 3600
_EXTENSIONS: dict[VideoType, str] = {"video/mp4": ".mp4", "video/webm": ".webm"}
# QuickTime (.mov) files also start with "ftyp", but most browsers can't play them.
_QUICKTIME_BRANDS = (b"qt  ",)
MAX_VIDEOS_PER_SURVEY = 50


class VideoError(ValueError):
    """An upload that isn't a playable video, or is too large."""


class VideoTooLarge(VideoError):  # noqa: N818 - reads as a sentence: raise VideoTooLarge
    pass


def sniff_video_type(head: bytes) -> VideoType | None:
    """MP4 or WebM from a file's first bytes, or None for anything else."""
    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] not in _QUICKTIME_BRANDS:  # noqa: PLR2004
        return "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3" and b"webm" in head[:64]:
        return "video/webm"
    return None


def display_name(filename: str | None) -> str:
    name = PurePath(filename or "").name.strip()
    return (name or "video")[:200]


def size_message(size: int, limit_mb: int) -> str:
    return f"That video is {size / (1024 * 1024):.0f} MB. Use one up to {limit_mb} MB."


async def create_video(
    session: AsyncSession,
    storage: LocalFileStorage,
    settings: Settings,
    *,
    survey_id: uuid.UUID,
    uploaded_by: str,
    filename: str | None,
    source: BinaryIO,
    size: int,
    duration_seconds: int | None,
) -> VideoAsset:
    """Check and store an uploaded video. `source` is read in chunks, never whole."""
    if size > settings.video_max_bytes:
        raise VideoTooLarge(size_message(size, settings.video_max_mb))
    head = source.read(64)
    content_type = sniff_video_type(head)
    if content_type is None:
        raise VideoError("That file isn't an MP4 or WebM video. Convert it to MP4 and try again.")
    source.seek(0)
    video_id = uuid.uuid4()
    path = f"videos/{survey_id}/{video_id}{_EXTENSIONS[content_type]}"
    written = storage.save_stream(path, source, max_bytes=settings.video_max_bytes)
    if written is None:
        raise VideoTooLarge(size_message(size, settings.video_max_mb))
    asset = VideoAsset(
        id=video_id,
        survey_id=survey_id,
        file_name=display_name(filename),
        path=path,
        content_type=content_type,
        size_bytes=written,
        duration_seconds=duration_seconds,
        uploaded_by=uploaded_by,
    )
    session.add(asset)
    try:
        await session.commit()
    except BaseException:
        storage.delete(path)
        raise
    await session.refresh(asset)
    return asset


async def list_videos(session: AsyncSession, survey_id: uuid.UUID) -> list[VideoAsset]:
    rows = await session.scalars(
        select(VideoAsset)
        .where(VideoAsset.survey_id == survey_id)
        .order_by(VideoAsset.created_at, VideoAsset.id)
    )
    return list(rows.all())


async def published_video_ids(session: AsyncSession, survey_id: uuid.UUID) -> set[str]:
    """Uploaded videos used by any published version of the survey (they can't be deleted)."""
    rows = await session.scalars(
        select(VersionSection.video["asset_id"].astext)
        .join(SurveyVersion, SurveyVersion.id == VersionSection.version_id)
        .where(
            SurveyVersion.survey_id == survey_id,
            VersionSection.video["source"].astext == "upload",
        )
    )
    return {value for value in rows.all() if value}


async def delete_video(session: AsyncSession, storage: LocalFileStorage, asset: VideoAsset) -> None:
    path = asset.path
    await session.delete(asset)
    await session.commit()
    storage.delete(path)


def delete_files(storage: LocalFileStorage, assets: Sequence[VideoAsset]) -> None:
    for asset in assets:
        storage.delete(asset.path)


async def copy_videos(
    session: AsyncSession,
    storage: LocalFileStorage,
    *,
    from_survey: uuid.UUID,
    to_survey: uuid.UUID,
    uploaded_by: str,
) -> dict[str, str]:
    """Copy every uploaded video of one survey to another (for "Duplicate").

    Returns old asset id -> new asset id, so the copy's draft can point at its own files.
    """
    mapping: dict[str, str] = {}
    for asset in await list_videos(session, from_survey):
        if not storage.exists(asset.path):
            continue
        new_id = uuid.uuid4()
        suffix = PurePath(asset.path).suffix
        path = f"videos/{to_survey}/{new_id}{suffix}"
        storage.copy(asset.path, path)
        session.add(
            VideoAsset(
                id=new_id,
                survey_id=to_survey,
                file_name=asset.file_name,
                path=path,
                content_type=asset.content_type,
                size_bytes=asset.size_bytes,
                duration_seconds=asset.duration_seconds,
                uploaded_by=uploaded_by,
            )
        )
        mapping[str(asset.id)] = str(new_id)
    return mapping


# --- signed links ------------------------------------------------------------------------------


def _signing_key(settings: Settings) -> bytes:
    # Its own derived key, so a video link can't be reused as an image link or a JWT.
    return hashlib.sha256(
        b"pulse-video-links:" + settings.jwt_secret.get_secret_value().encode()
    ).digest()


def _signature(settings: Settings, video_id: uuid.UUID, expires: int) -> str:
    message = f"{video_id}:{expires}".encode()
    return hmac.new(_signing_key(settings), message, hashlib.sha256).hexdigest()


def signed_path(settings: Settings, video_id: uuid.UUID, *, now: float | None = None) -> str:
    # Rounded to the hour so the same link is handed out for an hour (cacheable, seekable).
    current = int(now if now is not None else time.time())
    expires = (current // _HOUR + 1) * _HOUR + LINK_LIFETIME_SECONDS
    return (
        f"/api/files/videos/{video_id}?exp={expires}&sig={_signature(settings, video_id, expires)}"
    )


def check_signature(
    settings: Settings, video_id: uuid.UUID, expires: int, sig: str, *, now: float | None = None
) -> bool:
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(_signature(settings, video_id, expires), sig)


# --- publish checks ----------------------------------------------------------------------------


async def video_issues(
    session: AsyncSession, settings: Settings, survey_id: uuid.UUID, draft: Draft
) -> list[Issue]:
    """Each section video must be an upload of this survey or a usable link."""
    uploads = {str(a.id) for a in await list_videos(session, survey_id)}
    issues: list[Issue] = []
    for number, section in enumerate(draft.sections, start=1):
        video = section.video
        if video is None:
            continue
        name = section.title.strip() or f"Section {number}"
        key = str(section.key)
        if video.source == "upload" and (
            video.asset_id is None or str(video.asset_id) not in uploads
        ):
            issues.append(
                Issue("video_missing", f"{name}: upload its video, or remove it.", section_key=key)
            )
        elif video.source == "link" and not video.url:
            issues.append(
                Issue("video_missing", f"{name}: add the video's address.", section_key=key)
            )
        elif (
            video.source == "link"
            and video.url
            and settings.video_links_need_https
            and not video.url.lower().startswith("https://")
        ):
            issues.append(
                Issue(
                    "video_missing",
                    f"{name}: the video address must start with https:// "
                    "(browsers block http:// videos on a secure site).",
                    section_key=key,
                )
            )
    return issues


# --- progress ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Progress:
    furthest_seconds: int
    completed: bool


async def progress_for(
    session: AsyncSession, survey_id: uuid.UUID, employee_id: str
) -> dict[str, Progress]:
    rows = await session.scalars(
        select(VideoView).where(
            VideoView.survey_id == survey_id, VideoView.employee_id == employee_id
        )
    )
    return {
        str(row.section_key): Progress(row.furthest_seconds, row.completed_at is not None)
        for row in rows.all()
    }


async def record_progress(
    session: AsyncSession,
    *,
    survey_id: uuid.UUID,
    employee_id: str,
    section_key: uuid.UUID,
    furthest_seconds: int,
    completed: bool,
) -> Progress:
    """Furthest point only moves forward; "completed" only moves from false to true."""
    row = await session.get(VideoView, (survey_id, employee_id, section_key))
    now = datetime.now(UTC)
    if row is None:
        row = VideoView(
            survey_id=survey_id,
            employee_id=employee_id,
            section_key=section_key,
            furthest_seconds=0,
        )
        session.add(row)
    row.furthest_seconds = max(row.furthest_seconds or 0, furthest_seconds)
    if completed and row.completed_at is None:
        row.completed_at = now
    row.updated_at = now
    await session.commit()
    return Progress(row.furthest_seconds, row.completed_at is not None)
