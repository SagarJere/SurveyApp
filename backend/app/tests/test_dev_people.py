from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.scripts.seed import seed_dev_accounts
from app.tests.conftest import bearer


@pytest.fixture
async def people(
    client: AsyncClient, engine: AsyncEngine, token_for: Callable[..., str]
) -> AsyncEngine:
    """Seeded HR/admin accounts, plus audiences on two surveys."""
    await seed_dev_accounts(engine)
    hr = bearer(token_for("E1002", "hr"))
    first = (await client.post("/api/surveys", headers=hr)).json()["id"]
    second = (await client.post("/api/surveys", headers=hr)).json()["id"]
    rows: list[dict[str, Any]] = [
        {"s": first, "e": "T3001", "n": "Test person 3001", "d": "Sales", "l": "Pune"},
        {"s": second, "e": "T3001", "n": "Test person 3001", "d": "Sales", "l": "Pune"},
        {"s": first, "e": "T3002", "n": "Kavya_100%", "d": "Finance", "l": None},
        {"s": first, "e": "E2001", "n": "Priya Nair", "d": "Engineering", "l": "Pune"},
    ]
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO survey_audience (survey_id, employee_id, name, department, location)"
                " VALUES (CAST(:s AS uuid), :e, :n, :d, :l)"
            ),
            rows,
        )
    return engine


async def test_lists_test_accounts_first_then_audience(
    client: AsyncClient, people: AsyncEngine
) -> None:
    response = await client.get("/api/auth/dev-people")

    assert response.status_code == 200
    body = response.json()
    ids = [p["employee_id"] for p in body["items"]]
    assert ids == ["E1001", "E1002", "E2001", "E2002", "E2003", "E2004", "E2005", "T3001", "T3002"]
    assert body["total"] == 9
    by_id = {p["employee_id"]: p for p in body["items"]}
    assert by_id["E1001"]["role"] == "admin"
    assert by_id["E1002"]["role"] == "hr"
    # Known accounts pick up what the audience lists say about them.
    assert by_id["E2001"] == {
        "employee_id": "E2001",
        "name": "Priya Nair",
        "role": "employee",
        "department": "Engineering",
        "location": "Pune",
        "surveys": 1,
    }
    assert by_id["T3001"]["surveys"] == 2


async def test_search_matches_id_or_name_case_insensitively(
    client: AsyncClient, people: AsyncEngine
) -> None:
    by_name = (await client.get("/api/auth/dev-people", params={"search": "vikram"})).json()
    assert [p["employee_id"] for p in by_name["items"]] == ["E1002"]

    by_id = (await client.get("/api/auth/dev-people", params={"search": "t300"})).json()
    assert [p["employee_id"] for p in by_id["items"]] == ["T3001", "T3002"]
    assert by_id["total"] == 2


async def test_search_treats_wildcards_literally(client: AsyncClient, people: AsyncEngine) -> None:
    body = (await client.get("/api/auth/dev-people", params={"search": "_100%"})).json()
    assert [p["employee_id"] for p in body["items"]] == ["T3002"]
    assert (await client.get("/api/auth/dev-people", params={"search": "%"})).json()["total"] == 1


async def test_limit_keeps_the_total(client: AsyncClient, people: AsyncEngine) -> None:
    body = (await client.get("/api/auth/dev-people", params={"limit": 3})).json()
    assert [p["employee_id"] for p in body["items"]] == ["E1001", "E1002", "E2001"]
    assert body["total"] == 9
    assert (await client.get("/api/auth/dev-people", params={"limit": 51})).status_code == 422


async def test_audience_person_signs_in_with_their_uploaded_name(
    client: AsyncClient, people: AsyncEngine
) -> None:
    response = await client.post("/api/auth/login", json={"employee_id": "t3001"})
    assert response.json()["user"] == {
        "employee_id": "T3001",
        "name": "Test person 3001",
        "role": "employee",
    }


async def test_not_available_outside_dev_mode(
    app: FastAPI, client: AsyncClient, engine: AsyncEngine
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"auth_mode": "sso"})
    response = await client.get("/api/auth/dev-people")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
