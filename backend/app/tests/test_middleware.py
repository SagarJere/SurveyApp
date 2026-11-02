from httpx import AsyncClient


async def test_response_carries_generated_request_id(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    request_id = response.headers.get("x-request-id")
    assert request_id
    assert len(request_id) == 32


async def test_valid_incoming_request_id_is_echoed(client: AsyncClient) -> None:
    response = await client.get("/api/health", headers={"X-Request-ID": "abc-123.def_4"})

    assert response.headers["x-request-id"] == "abc-123.def_4"


async def test_unsafe_incoming_request_id_is_replaced(client: AsyncClient) -> None:
    response = await client.get("/api/health", headers={"X-Request-ID": "bad id\twith spaces"})

    assert response.headers["x-request-id"] != "bad id\twith spaces"


async def test_cors_preflight_allows_configured_origin(client: AsyncClient) -> None:
    response = await client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_cors_rejects_unknown_origin(client: AsyncClient) -> None:
    response = await client.get("/api/health", headers={"Origin": "http://evil.test"})

    assert "access-control-allow-origin" not in response.headers
