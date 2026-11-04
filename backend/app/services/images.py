"""Theme image processing (docs/01-requirements.md, Theme; docs/04-api.md, Theme assets).

Uploads: JPG, PNG or WebP up to 2 MB. Output: a full-size WebP (max 2400 px wide) and a mobile
WebP (800 px wide). EXIF orientation is applied, then all metadata (GPS, camera) is dropped.
"""

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 40_000_000  # refuse decompression bombs before decoding them
FULL_MAX_WIDTH = 2400
MOBILE_WIDTH = 800
WEBP_QUALITY = 80
ACCEPTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})


class ImageError(ValueError):
    """The upload can't be used. The message can be shown to the person as is."""


@dataclass(frozen=True, slots=True)
class ProcessedImage:
    full: bytes
    mobile: bytes
    width: int
    height: int


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MB"


def _resize_to_width(image: Image.Image, max_width: int) -> Image.Image:
    if image.width <= max_width:
        return image
    height = max(1, round(image.height * max_width / image.width))
    return image.resize((max_width, height), Image.Resampling.LANCZOS)


def _webp(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=WEBP_QUALITY, method=6)
    return out.getvalue()


def process_upload(data: bytes, *, max_bytes: int = MAX_UPLOAD_BYTES) -> ProcessedImage:
    """Check and convert an image. `max_bytes` is raised only for trusted gallery sources."""
    if len(data) > max_bytes:
        msg = (
            f"That image is {_megabytes(len(data))}. Use one under {max_bytes // (1024 * 1024)} MB."
        )
        raise ImageError(msg)
    if not data:
        msg = "That file is empty."
        raise ImageError(msg)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
            if probe.format not in ACCEPTED_FORMATS:
                msg = "Use a JPG, PNG or WebP image."
                raise ImageError(msg)
            if probe.width * probe.height > MAX_PIXELS:
                msg = "That image has too many pixels. Use one under 40 megapixels."
                raise ImageError(msg)
            probe.load()
    except ImageError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        msg = "Use a JPG, PNG or WebP image."
        raise ImageError(msg) from None
    except (OSError, SyntaxError, ValueError):
        msg = "That image looks damaged. Try saving it again and re-uploading."
        raise ImageError(msg) from None

    image = ImageOps.exif_transpose(probe)
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if has_alpha else "RGB")  # also drops EXIF and other metadata

    full = _resize_to_width(image, FULL_MAX_WIDTH)
    mobile = _resize_to_width(image, MOBILE_WIDTH)
    return ProcessedImage(
        full=_webp(full), mobile=_webp(mobile), width=full.width, height=full.height
    )
