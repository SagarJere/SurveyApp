import io
import random
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.services.images import ImageError, process_upload
from app.services.storage import LocalFileStorage
from app.services.theme_assets import GALLERY, check_signature, gallery_id, signed_path
from app.tests.conftest import bearer

Headers = dict[str, str]


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def other_hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1003", "hr"))


def noisy_jpeg(width: int, height: int, quality: int, seed: int = 1) -> bytes:
    """A photo-like JPEG: random noise compresses about as badly as a real photo."""
    rng = random.Random(seed)  # noqa: S311 - test data
    image = Image.frombytes("RGB", (width, height), rng.randbytes(width * height * 3))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def png(width: int, height: int, mode: str = "RGB", colour: Any = (10, 120, 100)) -> bytes:
    out = io.BytesIO()
    Image.new(mode, (width, height), colour).save(out, format="PNG")
    return out.getvalue()


async def _survey(client: AsyncClient, hr: Headers) -> str:
    survey_id: str = (await client.post("/api/surveys", headers=hr)).json()["id"]
    return survey_id


async def _upload(
    client: AsyncClient, hr: Headers, survey_id: str, data: bytes, name: str = "team.jpg"
) -> Any:
    return await client.post(
        f"/api/surveys/{survey_id}/theme-assets",
        headers=hr,
        files={"file": (name, data, "image/jpeg")},
    )


# --- gallery and signed links ---------------------------------------------------------------


async def test_gallery_lists_the_8_images_in_order(
    client: AsyncClient, hr: Headers, gallery: list[str]
) -> None:
    response = await client.get("/api/theme-assets/gallery", headers=hr)

    assert response.status_code == 200
    items = response.json()
    assert [i["name"] for i in items] == [name for _, name in GALLERY]
    assert items[0]["id"] == str(gallery_id("ocean"))
    assert items[0]["url"].startswith(f"/api/files/{items[0]['id']}?exp=")
    assert "/mobile?exp=" in items[0]["mobile_url"]


async def test_gallery_seeding_is_repeatable(
    client: AsyncClient, hr: Headers, gallery: list[str], app: Any, gallery_sources: Path
) -> None:
    from app.services.theme_assets import seed_gallery  # noqa: PLC0415

    async with app.state.sessionmaker() as session:
        again = await seed_gallery(session, app.state.storage, gallery_sources)

    assert again == gallery
    assert len((await client.get("/api/theme-assets/gallery", headers=hr)).json()) == 8


async def test_signed_links_serve_webp_without_a_token(
    client: AsyncClient, hr: Headers, gallery: list[str]
) -> None:
    ocean = (await client.get("/api/theme-assets/gallery", headers=hr)).json()[0]

    full = await client.get(ocean["url"])  # no Authorization header, like an <img> tag
    mobile = await client.get(ocean["mobile_url"])

    assert full.status_code == 200
    assert full.headers["content-type"] == "image/webp"
    assert "private" in full.headers["cache-control"]
    assert Image.open(io.BytesIO(full.content)).format == "WEBP"
    assert Image.open(io.BytesIO(mobile.content)).format == "WEBP"


async def test_tampered_or_expired_links_are_refused(
    client: AsyncClient, hr: Headers, gallery: list[str], settings: Settings
) -> None:
    ocean = (await client.get("/api/theme-assets/gallery", headers=hr)).json()[0]
    other = (await client.get("/api/theme-assets/gallery", headers=hr)).json()[1]
    sig = ocean["url"].split("sig=")[1]
    exp = int(ocean["url"].split("exp=")[1].split("&")[0])

    swapped = await client.get(f"/api/files/{other['id']}?exp={exp}&sig={sig}")
    longer = await client.get(f"/api/files/{ocean['id']}?exp={exp + 3600}&sig={sig}")
    variant = await client.get(f"/api/files/{ocean['id']}/mobile?exp={exp}&sig={sig}")

    assert swapped.status_code == 403
    assert longer.status_code == 403
    assert variant.status_code == 403
    assert not check_signature(settings, uuid.UUID(ocean["id"]), "full", exp, sig, now=exp + 1)


def test_links_are_stable_within_an_hour(settings: Settings) -> None:
    asset = uuid.uuid4()
    first = signed_path(settings, asset, "full", now=1_800_000_000)
    later = signed_path(settings, asset, "full", now=1_800_000_000 + 600)

    assert first == later


# --- uploads --------------------------------------------------------------------------------


async def test_large_jpg_becomes_webp_with_mobile_copy(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    data = noisy_jpeg(1400, 1100, quality=90)
    assert 1.2 * 1024 * 1024 < len(data) < 2 * 1024 * 1024  # about 1.5 MB
    survey_id = await _survey(client, hr)

    response = await _upload(client, hr, survey_id, data, name="Our office.jpg")

    assert response.status_code == 201, response.text
    asset = response.json()
    assert asset["kind"] == "upload"
    assert asset["name"] == "Our office"
    full = Image.open(io.BytesIO((await client.get(asset["url"])).content))
    mobile = Image.open(io.BytesIO((await client.get(asset["mobile_url"])).content))
    assert full.format == mobile.format == "WEBP"
    assert full.size == (1400, 1100)
    assert mobile.size == (800, 629)
    listed = (await client.get(f"/api/surveys/{survey_id}/theme-assets", headers=hr)).json()
    assert [a["id"] for a in listed] == [asset["id"]]


async def test_5mb_upload_is_rejected(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)

    response = await _upload(client, hr, survey_id, b"\xff\xd8" + b"0" * (5 * 1024 * 1024))

    assert response.status_code == 413
    assert response.json()["error"]["message"] == "That image is 5.0 MB. Use one under 2 MB."


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"hello, this is not an image", "Use a JPG, PNG or WebP image."),
        (b"", "That file is empty."),
    ],
)
async def test_non_images_are_rejected(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, data: bytes, message: str
) -> None:
    survey_id = await _survey(client, hr)

    response = await _upload(client, hr, survey_id, data)

    assert response.status_code == 422
    assert response.json()["error"]["message"] == message


async def test_uploads_need_edit_access(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, other_hr: Headers
) -> None:
    survey_id = await _survey(client, hr)

    response = await _upload(client, other_hr, survey_id, png(10, 10))

    assert response.status_code == 404


async def test_another_surveys_upload_cannot_be_used(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    first, second = await _survey(client, hr), await _survey(client, hr)
    asset = (await _upload(client, hr, first, png(40, 30))).json()
    survey = (await client.get(f"/api/surveys/{second}", headers=hr)).json()
    draft = {**survey["draft"], "theme": {**survey["draft"]["theme"], "cover": asset["id"]}}
    await client.put(
        f"/api/surveys/{second}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )

    issues = (await client.post(f"/api/surveys/{second}/validate", headers=hr)).json()["issues"]

    assert "The cover image is no longer available. Choose another." in [
        i["message"] for i in issues
    ]


# --- image processing -----------------------------------------------------------------------


def test_wide_images_are_scaled_down() -> None:
    result = process_upload(png(3000, 1000))

    assert (result.width, result.height) == (2400, 800)
    assert Image.open(io.BytesIO(result.mobile)).size == (800, 267)


def test_small_images_are_not_enlarged() -> None:
    result = process_upload(png(500, 300))

    assert Image.open(io.BytesIO(result.full)).size == (500, 300)
    assert Image.open(io.BytesIO(result.mobile)).size == (500, 300)


def test_exif_orientation_is_applied_and_metadata_dropped() -> None:
    image = Image.new("RGB", (400, 200), (200, 50, 50))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise to display
    exif[0x8825] = {2: (51, 30, 0)}  # GPS latitude
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)

    result = process_upload(out.getvalue())

    assert (result.width, result.height) == (200, 400)
    assert not Image.open(io.BytesIO(result.full)).getexif()


def test_transparency_is_kept() -> None:
    result = process_upload(png(50, 50, mode="RGBA", colour=(0, 0, 0, 0)))

    assert Image.open(io.BytesIO(result.full)).mode == "RGBA"


def test_gif_is_refused() -> None:
    out = io.BytesIO()
    Image.new("RGB", (10, 10)).save(out, format="GIF")

    with pytest.raises(ImageError, match=r"Use a JPG, PNG or WebP image\."):
        process_upload(out.getvalue())


def test_decompression_bombs_are_refused() -> None:
    bomb = png(8000, 6000, mode="L", colour=0)  # 48 megapixels, tiny file
    assert len(bomb) < 2 * 1024 * 1024

    with pytest.raises(ImageError, match="too many pixels"):
        process_upload(bomb)


def test_truncated_images_are_reported() -> None:
    data = noisy_jpeg(200, 200, quality=80)

    with pytest.raises(ImageError, match="damaged"):
        process_upload(data[: len(data) // 2])


# --- storage --------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["../escape.webp", "/etc/passwd", "a/../../b", ""])
def test_storage_refuses_unsafe_paths(tmp_path: Path, path: str) -> None:
    storage = LocalFileStorage(tmp_path)

    with pytest.raises(ValueError, match="Unsafe storage path"):
        storage.save(path, b"x")


def test_storage_writes_atomically(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path)

    storage.save("theme/a.webp", b"first")
    storage.save("theme/a.webp", b"second")

    assert storage.path("theme/a.webp").read_bytes() == b"second"
    assert [p.name for p in (tmp_path / "theme").iterdir()] == ["a.webp"]
