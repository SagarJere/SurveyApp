"""Theme images: the company gallery, per-survey uploads, and signed file links.

Browsers load images with <img> and CSS, which can't send the Authorization header. So the API
hands signed, expiring links (/api/files/{id}?exp=…&sig=…) to signed-in users only; the file
endpoint checks the signature instead of a token.
"""

import hashlib
import hmac
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import ThemeAsset
from app.services.images import process_upload
from app.services.storage import LocalFileStorage

Variant = Literal["full", "mobile"]

LINK_LIFETIME_SECONDS = 24 * 3600
_HOUR = 3600

# Gallery images get fixed IDs from their names, so drafts (and test fixtures) can refer to
# them the same way on every installation.
GALLERY_NAMESPACE = uuid.UUID("6f1c2b8e-3d4a-5b6c-8d9e-0a1b2c3d4e5f")
GALLERY = (
    ("ocean", "Ocean"),
    ("dawn", "Dawn"),
    ("forest", "Forest"),
    ("sand", "Sand"),
    ("waves", "Waves"),
    ("blueprint", "Blueprint"),
    ("dots", "Dots"),
    ("celebration", "Celebration"),
)
GALLERY_SOURCE_DIR = Path(__file__).resolve().parents[1] / "assets" / "gallery"
GALLERY_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
GALLERY_MAX_BYTES = 50 * 1024 * 1024  # gallery sources are trusted company artwork


def gallery_id(slug: str) -> uuid.UUID:
    return uuid.uuid5(GALLERY_NAMESPACE, f"gallery:{slug}")


def _signing_key(settings: Settings) -> bytes:
    # A key derived for this purpose only, so file links can't be used as JWTs or vice versa.
    return hashlib.sha256(
        b"pulse-file-links:" + settings.jwt_secret.get_secret_value().encode()
    ).digest()


def _signature(settings: Settings, asset_id: uuid.UUID, variant: Variant, expires: int) -> str:
    message = f"{asset_id}:{variant}:{expires}".encode()
    return hmac.new(_signing_key(settings), message, hashlib.sha256).hexdigest()


def signed_path(
    settings: Settings, asset_id: uuid.UUID, variant: Variant, *, now: float | None = None
) -> str:
    # Round the expiry up to the hour so the same link is handed out for an hour (cacheable).
    current = int(now if now is not None else time.time())
    expires = (current // _HOUR + 1) * _HOUR + LINK_LIFETIME_SECONDS
    suffix = "/mobile" if variant == "mobile" else ""
    sig = _signature(settings, asset_id, variant, expires)
    return f"/api/files/{asset_id}{suffix}?exp={expires}&sig={sig}"


def check_signature(
    settings: Settings,
    asset_id: uuid.UUID,
    variant: Variant,
    expires: int,
    sig: str,
    *,
    now: float | None = None,
) -> bool:
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(_signature(settings, asset_id, variant, expires), sig)


@dataclass(frozen=True, slots=True)
class AssetLinks:
    asset: ThemeAsset
    url: str
    mobile_url: str


def with_links(settings: Settings, assets: Sequence[ThemeAsset]) -> list[AssetLinks]:
    return [
        AssetLinks(
            asset=a,
            url=signed_path(settings, a.id, "full"),
            mobile_url=signed_path(settings, a.id, "mobile"),
        )
        for a in assets
    ]


async def list_gallery(session: AsyncSession) -> list[ThemeAsset]:
    order = {gallery_id(slug): i for i, (slug, _) in enumerate(GALLERY)}
    rows = (await session.scalars(select(ThemeAsset).where(ThemeAsset.kind == "gallery"))).all()
    return sorted(rows, key=lambda a: (order.get(a.id, len(order)), a.name))


async def list_uploads(session: AsyncSession, survey_id: uuid.UUID) -> list[ThemeAsset]:
    rows = await session.scalars(
        select(ThemeAsset)
        .where(ThemeAsset.survey_id == survey_id)
        .order_by(ThemeAsset.created_at, ThemeAsset.id)
    )
    return list(rows.all())


def _display_name(filename: str | None) -> str:
    stem = Path(filename or "").stem.strip()
    return (stem or "Upload")[:40]


async def create_upload(
    session: AsyncSession,
    storage: LocalFileStorage,
    *,
    survey_id: uuid.UUID,
    uploaded_by: str,
    filename: str | None,
    data: bytes,
) -> ThemeAsset:
    """Process and store an upload. Raises images.ImageError with a readable message."""
    processed = process_upload(data)
    asset_id = uuid.uuid4()
    path, mobile_path = f"theme/{asset_id}.webp", f"theme/{asset_id}-mobile.webp"
    storage.save(path, processed.full)
    storage.save(mobile_path, processed.mobile)
    asset = ThemeAsset(
        id=asset_id,
        survey_id=survey_id,
        kind="upload",
        name=_display_name(filename),
        path=path,
        mobile_path=mobile_path,
        width=processed.width,
        height=processed.height,
        uploaded_by=uploaded_by,
    )
    session.add(asset)
    try:
        await session.commit()
    except BaseException:
        storage.delete(path)
        storage.delete(mobile_path)
        raise
    await session.refresh(asset)
    return asset


async def usable_asset_ids(session: AsyncSession, survey_id: uuid.UUID) -> set[str]:
    """Asset IDs a survey's theme may use: the gallery plus its own uploads."""
    rows = await session.scalars(
        select(ThemeAsset.id).where(
            (ThemeAsset.kind == "gallery") | (ThemeAsset.survey_id == survey_id)
        )
    )
    return {str(asset_id) for asset_id in rows.all()}


async def seed_gallery(
    session: AsyncSession, storage: LocalFileStorage, source_dir: Path = GALLERY_SOURCE_DIR
) -> list[str]:
    """Load the company gallery from image files named after GALLERY slugs (ocean.jpg, …).

    Re-running replaces the stored images, so updated artwork can simply be dropped in.
    Returns the names loaded.
    """
    loaded: list[str] = []
    for slug, name in GALLERY:
        candidates = [source_dir / f"{slug}{ext}" for ext in GALLERY_EXTENSIONS]
        source = next((path for path in candidates if path.is_file()), None)
        if source is None:
            continue
        processed = process_upload(source.read_bytes(), max_bytes=GALLERY_MAX_BYTES)
        asset_id = gallery_id(slug)
        path, mobile_path = f"gallery/{slug}.webp", f"gallery/{slug}-mobile.webp"
        storage.save(path, processed.full)
        storage.save(mobile_path, processed.mobile)
        asset = await session.get(ThemeAsset, asset_id)
        if asset is None:
            asset = ThemeAsset(id=asset_id, kind="gallery", survey_id=None, uploaded_by="system")
            session.add(asset)
        asset.name = name
        asset.path, asset.mobile_path = path, mobile_path
        asset.width, asset.height = processed.width, processed.height
        loaded.append(name)
    await session.commit()
    return loaded
