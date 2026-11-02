import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import REPO_ROOT, Settings
from app.tests.conftest import BACKEND_DIR


def test_cors_origins_accepts_comma_separated_string(
    settings_factory: Callable[..., Settings],
) -> None:
    settings = settings_factory(cors_origins="http://a.test, http://b.test/ ,")

    assert settings.cors_origins == ["http://a.test", "http://b.test"]


def test_database_url_must_use_async_driver(settings_factory: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError, match="postgresql\\+asyncpg"):
        settings_factory(database_url="postgresql://u:p@localhost/db")


def test_relative_file_storage_resolves_from_repo_root(
    settings_factory: Callable[..., Settings],
) -> None:
    settings = settings_factory(file_storage_path="data/files")

    assert settings.file_storage_path == (REPO_ROOT / "data/files").resolve()


PRODUCTION_BASE: dict[str, object] = {
    "app_env": "production",
    "file_storage_path": Path("/srv/files"),
    "auth_mode": "dev",
}


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"jwt_secret": "short-but-16-chars"}, "JWT_SECRET must be at least"),
        ({"jwt_secret": "change-me-to-a-long-random-string"}, "placeholder"),
        ({"cors_origins": "*"}, "CORS_ORIGINS"),
        ({"db_echo": True}, "DB_ECHO"),
        ({"file_storage_path": "data/files"}, "FILE_STORAGE_PATH"),
        ({}, "AUTH_MODE=dev is not allowed when APP_ENV=production"),
    ],
)
def test_production_rejects_unsafe_settings(
    settings_factory: Callable[..., Settings], overrides: dict[str, object], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        settings_factory(**{**PRODUCTION_BASE, **overrides})


@pytest.mark.parametrize("app_env", ["development", "test", "production"])
def test_sso_mode_is_refused_until_it_exists(
    settings_factory: Callable[..., Settings], app_env: str
) -> None:
    with pytest.raises(ValidationError, match="AUTH_MODE=sso is not available yet"):
        settings_factory(app_env=app_env, auth_mode="sso", file_storage_path=Path("/srv/files"))


def test_jwt_secret_has_a_minimum_length(settings_factory: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError, match="jwt_secret"):
        settings_factory(jwt_secret="too-short")


def test_api_refuses_to_start_with_dev_auth_in_production() -> None:
    """The real startup path: importing the app with production + dev auth must fail."""
    env = {
        **os.environ,
        "APP_ENV": "production",
        "AUTH_MODE": "dev",
        "JWT_SECRET": "x" * 48,
        "FILE_STORAGE_PATH": "/srv/files",
    }
    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )

    assert result.returncode != 0
    assert "AUTH_MODE=dev is not allowed when APP_ENV=production" in result.stderr
    assert "x" * 48 not in result.stderr  # the secret is never printed


async def test_docs_disabled_in_production(settings: Settings) -> None:
    from httpx import ASGITransport, AsyncClient  # noqa: PLC0415

    from app.main import create_app  # noqa: PLC0415

    # Production settings can't be built until SSO exists, so flip the flag on valid settings.
    production = settings.model_copy(update={"app_env": "production"})
    app = create_app(production, setup_logging=False)
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver"
    ) as http:
        assert (await http.get("/api/docs")).status_code == 404
        assert (await http.get("/api/openapi.json")).status_code == 404
    await app.state.engine.dispose()
