from fastapi import FastAPI, HTTPException
from httpx import AsyncClient
from pydantic import BaseModel, Field

from app.errors import AppError


class _Payload(BaseModel):
    name: str = Field(min_length=1)
    count: int


def _add_test_routes(app: FastAPI) -> None:
    @app.post("/api/_test/validate")
    async def validate(payload: _Payload) -> dict[str, str]:
        return {"name": payload.name}

    @app.get("/api/_test/app-error")
    async def app_error() -> None:
        raise AppError(
            status_code=409,
            message="Someone else edited this survey.",
            details={"draft_updated_at": "2026-11-02T10:00:00Z"},
        )

    @app.get("/api/_test/http-exception")
    async def http_exception() -> None:
        raise HTTPException(status_code=403, detail="You can't edit this survey.")

    @app.get("/api/_test/crash")
    async def crash() -> None:
        msg = "database password is hunter2"
        raise RuntimeError(msg)


async def test_unknown_route_uses_error_shape(client: AsyncClient) -> None:
    response = await client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "NOT_FOUND", "message": "Not Found", "details": {}}
    }


async def test_wrong_method_uses_error_shape(client: AsyncClient) -> None:
    response = await client.post("/api/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


async def test_validation_errors_list_every_issue(app: FastAPI, client: AsyncClient) -> None:
    _add_test_routes(app)

    response = await client.post("/api/_test/validate", json={"name": "", "count": "many"})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_FAILED"
    assert error["message"] == "The request has 2 invalid fields."
    fields = {issue["field"] for issue in error["details"]["issues"]}
    assert fields == {"name", "count"}
    for issue in error["details"]["issues"]:
        assert issue["location"] == "body"
        assert issue["message"]
        assert issue["type"]


async def test_invalid_json_body_is_a_validation_error(app: FastAPI, client: AsyncClient) -> None:
    _add_test_routes(app)

    response = await client.post(
        "/api/_test/validate",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_app_error_keeps_code_message_and_details(app: FastAPI, client: AsyncClient) -> None:
    _add_test_routes(app)

    response = await client.get("/api/_test/app-error")

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "CONFLICT",
            "message": "Someone else edited this survey.",
            "details": {"draft_updated_at": "2026-11-02T10:00:00Z"},
        }
    }


async def test_http_exception_uses_error_shape(app: FastAPI, client: AsyncClient) -> None:
    _add_test_routes(app)

    response = await client.get("/api/_test/http-exception")

    assert response.status_code == 403
    assert response.json() == {
        "error": {"code": "FORBIDDEN", "message": "You can't edit this survey.", "details": {}}
    }


async def test_unhandled_error_returns_generic_500(app: FastAPI, client: AsyncClient) -> None:
    _add_test_routes(app)

    response = await client.get("/api/_test/crash")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "hunter2" not in response.text
