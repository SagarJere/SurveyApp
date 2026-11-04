"""Draw the 8 placeholder gallery images from docs/reference/ui-prototype.html.

    uv run python -m app.scripts.make_gallery_placeholders

Writes app/assets/gallery/<slug>.jpg. Replace any file with approved company artwork of the
same name (JPG, PNG or WebP), then run `python -m app.scripts.seed_gallery` to load it.
"""

import math
import random
import sys
from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from app.services.theme_assets import GALLERY_SOURCE_DIR

W, H = 2400, 1500
RGB = tuple[int, int, int]


def hex_rgb(value: str) -> RGB:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def linear(start: str, end: str, angle: float) -> Image.Image:
    """CSS linear-gradient(angle, start, end) over the whole image."""
    size = int(math.hypot(W, H)) + 4
    ramp = Image.linear_gradient("L").resize((size, size))
    ramp = ramp.rotate(180 - angle, resample=Image.Resampling.BICUBIC)
    left, top = (size - W) // 2, (size - H) // 2
    mask = ramp.crop((left, top, left + W, top + H))
    return Image.composite(
        Image.new("RGB", (W, H), hex_rgb(end)), Image.new("RGB", (W, H), hex_rgb(start)), mask
    )


def glow(
    base: Image.Image, colour: str, *, cx: float, cy: float, rx: float, ry: float, fade: float
) -> Image.Image:
    """CSS radial-gradient(rx ry at cx cy, colour 0%, transparent fade)."""
    radial = Image.radial_gradient("L").point(lambda v: max(0, round(255 * (1 - (v / 181) / fade))))
    ellipse = radial.resize((max(1, int(rx * W * 2)), max(1, int(ry * H * 2))))
    mask = Image.new("L", (W, H), 0)
    mask.paste(ellipse, (int(cx * W - ellipse.width / 2), int(cy * H - ellipse.height / 2)))
    return Image.composite(Image.new("RGB", (W, H), hex_rgb(colour)), base, mask)


def overlay(base: Image.Image, draw: Callable[[ImageDraw.ImageDraw], None]) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw(ImageDraw.Draw(layer))
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")


def ocean() -> Image.Image:
    image = linear("#0B5874", "#082640", 180)
    image = glow(image, "#3D7BD9", cx=0.88, cy=0.85, rx=0.7, ry=0.6, fade=0.65)
    return glow(image, "#8FE3F0", cx=0.18, cy=0.15, rx=0.8, ry=0.7, fade=0.6)


def dawn() -> Image.Image:
    image = linear("#6C5BB7", "#2E3A7A", 160)
    image = glow(image, "#F49AB0", cx=0.92, cy=0.30, rx=0.9, ry=0.8, fade=0.6)
    return glow(image, "#FFD3A1", cx=0.12, cy=0.08, rx=1.1, ry=0.9, fade=0.55)


def forest() -> Image.Image:
    return glow(
        linear("#2F6B4F", "#0F2E24", 170), "#A3DDA8", cx=0.80, cy=0.0, rx=0.9, ry=0.7, fade=0.6
    )


def sand() -> Image.Image:
    return glow(
        linear("#E2BF8A", "#A8733F", 160), "#FFF2D9", cx=0.75, cy=0.20, rx=0.7, ry=0.6, fade=0.6
    )


def waves() -> Image.Image:
    def draw(d: ImageDraw.ImageDraw) -> None:
        for baseline in (0.62, 0.79):
            points: list[tuple[float, float]] = [(0, H)]
            for x in range(0, W + 1, 8):
                points.append(
                    (x, H * baseline + 0.09 * H * math.sin(x / W * 2 * math.pi + math.pi))
                )
            points.append((W, H))
            d.polygon(points, fill=(255, 255, 255, 33))

    return overlay(linear("#2B6CB0", "#1A365D", 160), draw)


def blueprint() -> Image.Image:
    step = 48

    def draw(d: ImageDraw.ImageDraw) -> None:
        for x in range(0, W, step):
            d.line([(x, 0), (x, H)], fill=(255, 255, 255, 46), width=2)
        for y in range(0, H, step):
            d.line([(0, y), (W, y)], fill=(255, 255, 255, 46), width=2)

    return overlay(linear("#2457A6", "#16336B", 160), draw)


def dots() -> Image.Image:
    step, r = 36, 3

    def draw(d: ImageDraw.ImageDraw) -> None:
        for y in range(step // 2, H, step):
            for x in range(step // 2, W, step):
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 77))

    return overlay(linear("#0E7A6A", "#123B36", 135), draw)


def celebration() -> Image.Image:
    rng = random.Random(7)  # noqa: S311 - artwork, not security; same picture every run
    colours = [(0xFF, 0xC9, 0x4D), (0xFF, 0x7A, 0xA8), (0x7F, 0xE0, 0xC4)]

    def draw(d: ImageDraw.ImageDraw) -> None:
        for _ in range(420):
            x, y = rng.uniform(0, W), rng.uniform(0, H)
            r = rng.uniform(4, 8)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(*rng.choice(colours), 235))

    return overlay(linear("#4A2A7A", "#241445", 160), draw)


DRAWINGS: dict[str, Callable[[], Image.Image]] = {
    "ocean": ocean,
    "dawn": dawn,
    "forest": forest,
    "sand": sand,
    "waves": waves,
    "blueprint": blueprint,
    "dots": dots,
    "celebration": celebration,
}


def main(target: Path = GALLERY_SOURCE_DIR) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for slug, draw in DRAWINGS.items():
        image = draw()
        # Soft noise stops gradients banding once they are compressed.
        noise = Image.effect_noise((W, H), 6).convert("RGB")
        image = ImageChops.blend(image, ImageChops.add(image, noise, scale=2, offset=-64), 0.08)
        image.save(target / f"{slug}.jpg", quality=86, optimize=True, progressive=True)
        sys.stdout.write(f"wrote {slug}.jpg\n")


if __name__ == "__main__":
    main()
