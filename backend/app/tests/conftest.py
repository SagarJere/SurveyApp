"""Shared test fixtures.

Tests run against the `surveyapp_test` database (TEST_DATABASE_URL), never the dev database.
"""

import os
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.auth.jwt import issue_token
from app.auth.types import AuthenticatedUser, Role
from app.config import Settings

DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://surveyapp:surveyapp@localhost:5433/surveyapp_test"
TEST_JWT_SECRET = "test-secret-that-is-long-enough-for-every-check-0123456789"


def test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "jwt_secret": TEST_JWT_SECRET,
        "database_url": test_database_url(),
        "cors_origins": ["http://localhost:5173"],
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings.model_validate(values)


@pytest.fixture
def settings_factory() -> Callable[..., Settings]:
    return make_settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Each test stores files in its own temporary folder.
    return make_settings(file_storage_path=tmp_path / "files")


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    from app.main import create_app  # noqa: PLC0415 - import after env is prepared

    return create_app(settings, setup_logging=False)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
    await app.state.engine.dispose()


BACKEND_DIR = Path(__file__).resolve().parents[2]
# Tables emptied after every test. Add new tables here as later phases create them.
TABLES = (
    "response_shown",
    "response_answers",
    "survey_participation",
    "survey_responses",
    "survey_audience",
    "audience_uploads",
    "question_options",
    "survey_questions",
    "survey_sections",
    "theme_assets",
    "survey_versions",
    "survey_members",
    "surveys",
    "app_users",
)


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Bring the test database to the latest migration once per test run."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(config, "head")


@pytest.fixture
async def engine(app: FastAPI) -> AsyncIterator[AsyncEngine]:
    """The app's engine, with every table emptied after the test."""
    db: AsyncEngine = app.state.engine
    yield db
    async with db.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)}"))


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def token_for(settings: Settings) -> Callable[..., str]:
    """Make a valid access token for any user without going through login."""

    def make(employee_id: str = "E9999", role: Role = "employee", name: str | None = None) -> str:
        user = AuthenticatedUser(employee_id=employee_id, name=name, role=role)
        return issue_token(user, settings).token

    return make


def pytest_configure() -> None:
    # `app.main` builds a module-level app on import, which reads settings from the environment.
    os.environ.setdefault("JWT_SECRET", TEST_JWT_SECRET)
    os.environ["DATABASE_URL"] = test_database_url()
    os.environ["APP_ENV"] = "test"


@pytest.fixture(scope="session")
def gallery_sources(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Small stand-ins for the 8 gallery images (the real ones are slow to convert)."""
    from PIL import Image  # noqa: PLC0415

    from app.services.theme_assets import GALLERY  # noqa: PLC0415

    folder = tmp_path_factory.mktemp("gallery")
    for index, (slug, _) in enumerate(GALLERY):
        Image.new("RGB", (320, 200), (20 * index, 90, 120)).save(folder / f"{slug}.jpg")
    return folder


@pytest.fixture
async def gallery(app: FastAPI, engine: AsyncEngine, gallery_sources: Path) -> list[str]:
    """Load the 8 company gallery images into the test database and storage."""
    from app.services.theme_assets import seed_gallery  # noqa: PLC0415

    async with app.state.sessionmaker() as session:
        return await seed_gallery(session, app.state.storage, gallery_sources)
