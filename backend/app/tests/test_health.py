from collections.abc import Callable

from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


async def test_health_ok_when_database_reachable(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["environment"] == "test"
    assert body["version"]


async def test_health_returns_503_with_error_shape_when_database_down(
    settings_factory: Callable[..., Settings],
) -> None:
    # Port 1 is never a Postgres server, so the connection is refused immediately.
    settings = settings_factory(
        database_url="postgresql+asyncpg://nobody:nothing@127.0.0.1:1/missing",
        health_db_timeout_seconds=2,
    )
    app = create_app(settings, setup_logging=False)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        response = await http.get("/api/health")
    await app.state.engine.dispose()

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "SERVICE_UNAVAILABLE",
            "message": "The database is not reachable.",
            "details": {"database": "unreachable"},
        }
    }


async def test_health_does_not_leak_connection_details_when_down(
    settings_factory: Callable[..., Settings],
) -> None:
    settings = settings_factory(
        database_url="postgresql+asyncpg://secret_user:secret_pw@127.0.0.1:1/missing"
    )
    app = create_app(settings, setup_logging=False)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        response = await http.get("/api/health")
    await app.state.engine.dispose()

    assert "secret_pw" not in response.text
    assert "secret_user" not in response.text
