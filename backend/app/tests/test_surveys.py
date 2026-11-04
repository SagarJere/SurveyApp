import copy
import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.tests.conftest import bearer

PULSE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/workplace-pulse.json").read_text()
)["draft"]

Headers = dict[str, str]


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr", "Vikram Mehta"))


@pytest.fixture
def other_hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1003", "hr", "Other HR"))


@pytest.fixture
def admin(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1001", "admin", "Asha Rao"))


@pytest.fixture
def employee(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E2001", "employee"))


async def _create(client: AsyncClient, headers: Headers) -> dict[str, Any]:
    response = await client.post("/api/surveys", headers=headers)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _save(
    client: AsyncClient, headers: Headers, survey: dict[str, Any], draft: dict[str, Any]
) -> Any:
    return await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=headers,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )


async def _pulse_survey(client: AsyncClient, headers: Headers) -> dict[str, Any]:
    survey = await _create(client, headers)
    saved = await _save(client, headers, survey, PULSE)
    assert saved.status_code == 200, saved.text
    survey["draft_updated_at"] = saved.json()["draft_updated_at"]
    return survey


# --- create and list ------------------------------------------------------------------------


async def test_create_makes_an_empty_draft_with_one_section(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = await _create(client, hr)

    assert survey["status"] == "draft"
    assert survey["title"] == ""
    assert survey["my_role"] == "owner"
    assert survey["can_edit"] is True
    assert survey["can_delete"] is True
    assert survey["version_no"] is None
    draft = survey["draft"]
    assert len(draft["sections"]) == 1
    assert draft["questions"] == []
    assert draft["settings"]["layout"] == "step"  # agreed default: one question at a time
    assert draft["theme"]["accent"] == "#0E7A6A"


async def test_employees_cannot_create_or_list(
    client: AsyncClient, engine: AsyncEngine, employee: Headers
) -> None:
    assert (await client.post("/api/surveys", headers=employee)).status_code == 403
    assert (await client.get("/api/surveys", headers=employee)).status_code == 403


async def test_list_shows_your_surveys_only(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, other_hr: Headers, admin: Headers
) -> None:
    mine = await _pulse_survey(client, hr)
    theirs = await _create(client, other_hr)

    my_list = (await client.get("/api/surveys", headers=hr)).json()
    admin_list = (await client.get("/api/surveys", headers=admin)).json()

    assert [s["id"] for s in my_list] == [mine["id"]]
    assert my_list[0]["title"] == "Workplace pulse, Q4 2026"
    assert my_list[0]["opens_at"] == "2026-11-10"
    assert my_list[0]["closes_at"] == "2026-11-24"
    assert my_list[0]["response_count"] == 0
    assert {s["id"] for s in admin_list} == {mine["id"], theirs["id"]}
    assert all(s["my_role"] is None for s in admin_list)
    assert all(s["can_edit"] for s in admin_list)


async def test_list_is_newest_first(client: AsyncClient, engine: AsyncEngine, hr: Headers) -> None:
    first = await _create(client, hr)
    second = await _create(client, hr)
    await _save(client, hr, first, {**first["draft"], "title": "Edited later"})

    ids = [s["id"] for s in (await client.get("/api/surveys", headers=hr)).json()]

    assert ids == [first["id"], second["id"]]


# --- read and access ------------------------------------------------------------------------


async def test_reload_restores_the_whole_sample_survey(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)

    reloaded = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()

    assert reloaded["draft"] == PULSE
    assert reloaded["title"] == PULSE["title"]
    assert reloaded["draft_updated_at"] == survey["draft_updated_at"]


@pytest.mark.parametrize("who", ["other_hr", "employee"])
async def test_non_members_get_404(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, who: str, request: pytest.FixtureRequest
) -> None:
    survey = await _create(client, hr)
    headers: Headers = request.getfixturevalue(who)

    for method, path in [
        ("GET", ""),
        ("PUT", "/draft"),
        ("POST", "/validate"),
        ("POST", "/duplicate"),
        ("DELETE", ""),
    ]:
        body = {"draft": survey["draft"], "draft_updated_at": survey["draft_updated_at"]}
        response = await client.request(
            method,
            f"/api/surveys/{survey['id']}{path}",
            headers=headers,
            json=body if method == "PUT" else None,
        )
        expected = 403 if who == "employee" and path == "/duplicate" else 404
        assert response.status_code == expected, (method, path, response.text)


async def test_admin_can_open_and_edit_any_survey(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, admin: Headers
) -> None:
    survey = await _create(client, hr)

    response = await client.get(f"/api/surveys/{survey['id']}", headers=admin)
    saved = await _save(client, admin, survey, {**survey["draft"], "title": "Admin edit"})

    assert response.status_code == 200
    assert response.json()["can_edit"] is True
    assert saved.status_code == 200


async def test_unknown_and_malformed_ids(client: AsyncClient, hr: Headers) -> None:
    assert (await client.get(f"/api/surveys/{uuid.uuid4()}", headers=hr)).status_code == 404
    assert (await client.get("/api/surveys/not-a-uuid", headers=hr)).status_code == 422


async def test_viewers_can_read_but_not_edit(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, other_hr: Headers
) -> None:
    survey = await _create(client, hr)
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO survey_members VALUES (:id, 'E1003', 'viewer')"), {"id": survey["id"]}
        )

    read = await client.get(f"/api/surveys/{survey['id']}", headers=other_hr)
    save = await _save(client, other_hr, survey, survey["draft"])
    delete = await client.delete(f"/api/surveys/{survey['id']}", headers=other_hr)

    assert read.status_code == 200
    assert read.json()["my_role"] == "viewer"
    assert read.json()["can_edit"] is False
    assert save.status_code == 403
    assert delete.status_code == 403


# --- saving ---------------------------------------------------------------------------------


async def test_save_returns_a_new_timestamp(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = await _create(client, hr)

    response = await _save(client, hr, survey, {**survey["draft"], "title": "New title"})

    assert response.status_code == 200
    assert response.json()["draft_updated_at"] != survey["draft_updated_at"]


async def test_two_tabs_get_a_conflict(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = await _create(client, hr)
    tab_a, tab_b = dict(survey), dict(survey)

    first = await _save(client, hr, tab_a, {**survey["draft"], "title": "From tab A"})
    second = await _save(client, hr, tab_b, {**survey["draft"], "title": "From tab B"})

    assert first.status_code == 200
    assert second.status_code == 409
    error = second.json()["error"]
    assert error["code"] == "DRAFT_CONFLICT"
    assert error["message"] == "Someone else edited this survey. Reload to see their changes."
    assert error["details"]["draft_updated_at"]
    reloaded = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert reloaded["title"] == "From tab A"

    tab_b["draft_updated_at"] = reloaded["draft_updated_at"]
    retry = await _save(client, hr, tab_b, {**reloaded["draft"], "title": "From tab B"})
    assert retry.status_code == 200


def _broken(mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    draft = copy.deepcopy(PULSE)
    mutate(draft)
    return draft


def _dup_key(d: dict[str, Any]) -> None:
    d["questions"][1]["key"] = d["questions"][0]["key"]


def _unknown_section(d: dict[str, Any]) -> None:
    d["questions"][0]["section_key"] = str(uuid.uuid4())


def _ungrouped(d: dict[str, Any]) -> None:
    d["questions"].insert(0, d["questions"].pop())


def _no_sections(d: dict[str, Any]) -> None:
    d["sections"] = []
    d["questions"] = []


def _bad_accent(d: dict[str, Any]) -> None:
    d["theme"]["accent"] = "#FF00FF"


def _negative_money(d: dict[str, Any]) -> None:
    d["questions"][4]["config"]["min"] = -1


def _unknown_type(d: dict[str, Any]) -> None:
    d["questions"][0]["type"] = "nps"


def _extra_field(d: dict[str, Any]) -> None:
    d["questions"][0]["colour"] = "red"


def _bad_overlay(d: dict[str, Any]) -> None:
    d["theme"]["overlay"] = 33


@pytest.mark.parametrize(
    "mutate",
    [
        _dup_key,
        _unknown_section,
        _ungrouped,
        _no_sections,
        _bad_accent,
        _negative_money,
        _unknown_type,
        _extra_field,
        _bad_overlay,
    ],
)
async def test_structurally_invalid_drafts_are_rejected(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    mutate: Callable[[dict[str, Any]], None],
) -> None:
    survey = await _create(client, hr)

    response = await _save(client, hr, survey, _broken(mutate))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_incomplete_drafts_can_still_be_saved(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = await _create(client, hr)

    def incomplete(d: dict[str, Any]) -> None:
        d["questions"][0]["text"] = ""
        d["questions"][2]["condition"]["src"] = str(uuid.uuid4())  # broken condition

    response = await _save(client, hr, survey, _broken(incomplete))

    assert response.status_code == 200


# --- validate -------------------------------------------------------------------------------


async def test_sample_survey_has_no_issues(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)

    response = await client.post(f"/api/surveys/{survey['id']}/validate", headers=hr)

    assert response.status_code == 200
    assert response.json() == {"issues": []}


async def test_moving_q2_below_q3_is_reported(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)
    q3_key = PULSE["questions"][2]["key"]

    def move_q2_down(d: dict[str, Any]) -> None:
        q = d["questions"]
        q[1], q[2] = q[2], q[1]

    await _save(client, hr, survey, _broken(move_q2_down))

    issues = (await client.post(f"/api/surveys/{survey['id']}/validate", headers=hr)).json()[
        "issues"
    ]

    assert issues == [
        {
            "code": "condition_broken",
            "message": "Q2 has a condition that needs attention.",
            "question_key": q3_key,
            "section_key": None,
            "problem": "source_after",
        }
    ]


async def test_new_survey_needs_a_question(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = await _create(client, hr)

    issues = (await client.post(f"/api/surveys/{survey['id']}/validate", headers=hr)).json()[
        "issues"
    ]

    assert [i["code"] for i in issues] == ["no_questions"]


# --- duplicate and delete -------------------------------------------------------------------


async def test_duplicate_copies_with_fresh_keys(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)

    response = await client.post(f"/api/surveys/{survey['id']}/duplicate", headers=hr)

    assert response.status_code == 201
    dup = response.json()
    assert dup["id"] != survey["id"]
    assert dup["title"] == "Workplace pulse, Q4 2026 (copy)"
    assert dup["my_role"] == "owner"
    old_keys = {q["key"] for q in PULSE["questions"]}
    new_keys = {q["key"] for q in dup["draft"]["questions"]}
    assert old_keys.isdisjoint(new_keys)
    assert [q["text"] for q in dup["draft"]["questions"]] == [q["text"] for q in PULSE["questions"]]
    issues = (await client.post(f"/api/surveys/{dup['id']}/validate", headers=hr)).json()
    assert issues == {"issues": []}  # conditions were remapped to the new keys


async def test_owner_deletes_a_draft(client: AsyncClient, engine: AsyncEngine, hr: Headers) -> None:
    survey = await _create(client, hr)

    response = await client.delete(f"/api/surveys/{survey['id']}", headers=hr)

    assert response.status_code == 204
    assert (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).status_code == 404


async def test_published_surveys_cannot_be_deleted(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)
    published = await client.post(f"/api/surveys/{survey['id']}/publish", headers=hr)
    assert published.status_code == 200, published.text

    listed = (await client.get("/api/surveys", headers=hr)).json()[0]
    response = await client.delete(f"/api/surveys/{survey['id']}", headers=hr)

    assert listed["can_delete"] is False
    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "Published surveys can't be deleted. Close the survey instead."
    )


async def test_saving_after_publish_marks_unpublished_changes(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _pulse_survey(client, hr)
    published = await client.post(f"/api/surveys/{survey['id']}/publish", headers=hr)
    assert published.status_code == 200, published.text

    await _save(client, hr, survey, {**PULSE, "title": "Changed"})

    reloaded = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert reloaded["has_unpublished_changes"] is True
