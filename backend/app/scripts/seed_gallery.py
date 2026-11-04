"""Load the company gallery images into storage and the database.

    uv run python -m app.scripts.seed_gallery

Reads app/assets/gallery/<slug>.(jpg|png|webp) for the 8 gallery names. Safe to re-run:
images are replaced in place and keep their IDs. Needed in every environment, production too.
"""

import asyncio
import sys

from app.config import get_settings
from app.db import create_engine, create_sessionmaker
from app.services.storage import LocalFileStorage
from app.services.theme_assets import GALLERY, seed_gallery


async def main() -> None:
    settings = get_settings()
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            loaded = await seed_gallery(session, LocalFileStorage(settings.file_storage_path))
    finally:
        await engine.dispose()
    missing = len(GALLERY) - len(loaded)
    sys.stdout.write(f"Loaded {len(loaded)} gallery images: {', '.join(loaded)}\n")
    if missing:
        sys.stdout.write(f"{missing} gallery image(s) have no source file in app/assets/gallery.\n")


if __name__ == "__main__":
    asyncio.run(main())
