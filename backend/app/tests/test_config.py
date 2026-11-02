from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import REPO_ROOT, Settings


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


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"jwt_secret": "short"}, "JWT_SECRET"),
        ({"cors_origins": "*"}, "CORS_ORIGINS"),
        ({"db_echo": True}, "DB_ECHO"),
        ({"file_storage_path": "data/files"}, "FILE_STORAGE_PATH"),
    ],
)
def test_production_rejects_unsafe_settings(
    settings_factory: Callable[..., Settings], overrides: dict[str, object], message: str
) -> None:
    base: dict[str, object] = {"app_env": "production", "file_storage_path": Path("/srv/files")}
    base.update(overrides)
    with pytest.raises(ValidationError, match=message):
        settings_factory(**base)


def test_production_with_safe_settings_is_accepted(
    settings_factory: Callable[..., Settings],
) -> None:
    settings = settings_factory(app_env="production", file_storage_path=Path("/srv/files"))

    assert settings.is_production


async def test_docs_disabled_in_production(settings_factory: Callable[..., Settings]) -> None:
    from httpx import ASGITransport, AsyncClient  # noqa: PLC0415

    from app.main import create_app  # noqa: PLC0415

    app = create_app(
        settings_factory(app_env="production", file_storage_path=Path("/srv/files")),
        setup_logging=False,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver"
    ) as http:
        assert (await http.get("/api/docs")).status_code == 404
        assert (await http.get("/api/openapi.json")).status_code == 404
    await app.state.engine.dispose()
