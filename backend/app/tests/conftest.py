"""Shared test fixtures.

Tests run against the `surveyapp_test` database (TEST_DATABASE_URL), never the dev database.
"""

import os
from collections.abc import AsyncIterator, Callable

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

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
def settings() -> Settings:
    return make_settings()


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


def pytest_configure() -> None:
    # `app.main` builds a module-level app on import, which reads settings from the environment.
    os.environ.setdefault("JWT_SECRET", TEST_JWT_SECRET)
    os.environ["DATABASE_URL"] = test_database_url()
    os.environ["APP_ENV"] = "test"
