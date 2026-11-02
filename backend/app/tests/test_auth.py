from collections.abc import Callable

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from app.auth.deps import AdminUser, CurrentUser, HrUser
from app.scripts.seed import seed_dev_accounts
from app.tests.conftest import bearer


@pytest.fixture
async def seeded(engine: AsyncEngine) -> AsyncEngine:
    await seed_dev_accounts(engine)
    return engine


def _add_role_routes(app: FastAPI) -> None:
    @app.get("/api/_test/anyone")
    async def anyone(user: CurrentUser) -> dict[str, str]:
        return {"employee_id": user.employee_id}

    @app.get("/api/_test/hr")
    async def hr_only(user: HrUser) -> dict[str, str]:
        return {"role": user.role}

    @app.get("/api/_test/admin")
    async def admin_only(user: AdminUser) -> dict[str, str]:
        return {"role": user.role}


# --- login -------------------------------------------------------------------------------


async def test_seeded_hr_user_logs_in_with_hr_role(
    client: AsyncClient, seeded: AsyncEngine
) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "E1002"})

    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"employee_id": "E1002", "name": "Vikram Mehta", "role": "hr"}
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["expires_at"]


async def test_seeded_admin_logs_in_as_admin(client: AsyncClient, seeded: AsyncEngine) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "e1001"})

    assert response.json()["user"]["role"] == "admin"


async def test_unknown_id_logs_in_as_employee(client: AsyncClient, seeded: AsyncEngine) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "X77"})

    assert response.status_code == 200
    assert response.json()["user"] == {"employee_id": "X77", "name": None, "role": "employee"}


async def test_dev_test_employee_gets_a_display_name(
    client: AsyncClient, seeded: AsyncEngine
) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "E2001"})

    assert response.json()["user"] == {
        "employee_id": "E2001",
        "name": "Priya Nair",
        "role": "employee",
    }


async def test_login_normalises_the_id(client: AsyncClient, engine: AsyncEngine) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": " e123 "})

    assert response.status_code == 200
    assert response.json()["user"]["employee_id"] == "E123"


async def test_normalised_id_matches_seeded_role(client: AsyncClient, seeded: AsyncEngine) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "  e1002\t"})

    assert response.json()["user"]["role"] == "hr"


@pytest.mark.parametrize(
    ("employee_id", "message"),
    [
        ("", "Enter your employee ID."),
        ("   ", "Enter your employee ID."),
        ("E 12", "Employee IDs can't contain spaces."),
        ("E" * 31, "Employee IDs can't be longer than 30 characters."),
    ],
)
async def test_invalid_ids_return_422_with_a_readable_message(
    client: AsyncClient, employee_id: str, message: str
) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": employee_id})

    assert response.status_code == 422
    issue = response.json()["error"]["details"]["issues"][0]
    assert issue["field"] == "employee_id"
    assert issue["message"] == message


async def test_missing_body_is_a_validation_error(client: AsyncClient) -> None:
    response = await client.post("/api/auth/login", json={})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


# --- /auth/me and token checks ---------------------------------------------------------


async def test_me_returns_the_token_user(client: AsyncClient, seeded: AsyncEngine) -> None:
    login = await client.post("/api/auth/login", json={"employee_id": "E1002"})
    token = login.json()["access_token"]

    response = await client.get("/api/auth/me", headers=bearer(token))

    assert response.status_code == 200
    assert response.json() == {"employee_id": "E1002", "name": "Vikram Mehta", "role": "hr"}


async def test_me_without_token_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"] == {
        "code": "UNAUTHORIZED",
        "message": "Please sign in to continue.",
        "details": {},
    }


async def test_me_with_wrong_scheme_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me", headers={"Authorization": "Basic abc"})

    assert response.status_code == 401


async def test_expired_token_is_401_token_expired(
    client: AsyncClient, settings_factory: Callable[..., object]
) -> None:
    from datetime import UTC, datetime, timedelta  # noqa: PLC0415

    from app.auth.jwt import issue_token  # noqa: PLC0415
    from app.auth.types import AuthenticatedUser  # noqa: PLC0415
    from app.config import Settings  # noqa: PLC0415

    settings = settings_factory()
    assert isinstance(settings, Settings)
    old = issue_token(
        AuthenticatedUser("E2001", None, "employee"),
        settings,
        now=datetime.now(UTC) - timedelta(hours=9),
    )

    response = await client.get("/api/auth/me", headers=bearer(old.token))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"
    assert response.json()["error"]["message"] == "Your session has expired. Please sign in again."


async def test_invalid_token_is_401_invalid_token(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me", headers=bearer("abc.def.ghi"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"


# --- role checks ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "role", "expected"),
    [
        ("/api/_test/anyone", "employee", 200),
        ("/api/_test/anyone", "hr", 200),
        ("/api/_test/hr", "employee", 403),
        ("/api/_test/hr", "hr", 200),
        ("/api/_test/hr", "admin", 200),  # admins can do everything HR can
        ("/api/_test/admin", "employee", 403),
        ("/api/_test/admin", "hr", 403),
        ("/api/_test/admin", "admin", 200),
    ],
)
async def test_role_checks(  # noqa: PLR0917 - pytest injects fixtures and parameters
    app: FastAPI,
    client: AsyncClient,
    token_for: Callable[..., str],
    path: str,
    role: str,
    expected: int,
) -> None:
    _add_role_routes(app)

    response = await client.get(path, headers=bearer(token_for(role=role)))

    assert response.status_code == expected
    if expected == 403:
        assert response.json()["error"] == {
            "code": "FORBIDDEN",
            "message": "You don't have access to this.",
            "details": {},
        }


async def test_role_checks_need_a_token(app: FastAPI, client: AsyncClient) -> None:
    _add_role_routes(app)

    response = await client.get("/api/_test/hr")

    assert response.status_code == 401


def test_require_role_needs_roles() -> None:
    from app.auth.deps import require_role  # noqa: PLC0415

    with pytest.raises(ValueError, match="at least one role"):
        require_role()
