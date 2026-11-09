import copy
import io
import json
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.tests.conftest import bearer

PULSE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/workplace-pulse.json").read_text()
)["draft"]
Q = [q["key"] for q in PULSE["questions"]]  # Q[0] is Q1
OFFICE, HYBRID, REMOTE = (o["key"] for o in PULSE["questions"][1]["options"])
MANAGER, NOT_MANAGER = (o["key"] for o in PULSE["questions"][5]["options"])
DAYS_3_4 = PULSE["questions"][2]["options"][1]["key"]

Headers = dict[str, str]


def today() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def answers_office(**extra: Any) -> dict[str, Any]:
    """A complete, valid set of answers for someone who works in the office, not a manager."""
    return {Q[0]: 4, Q[1]: OFFICE, Q[5]: NOT_MANAGER, Q[8]: "All good", **extra}


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def priya(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E2001", "employee", "Priya Nair"))


@pytest.fixture
def outsider(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E9999", "employee"))


def _xlsx(rows: list[list[Any]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["EmployeeId", "Name", "Email", "Department", "Location"])
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


async def publish(
    client: AsyncClient,
    hr: Headers,
    *,
    settings: dict[str, Any] | None = None,
    audience: list[list[Any]] | None = None,
    open_to_all: bool = False,
) -> str:
    draft = copy.deepcopy(PULSE)
    draft["settings"].update(
        {
            "opens_at": (today() - timedelta(days=1)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
        }
    )
    draft["settings"].update(settings or {})
    survey = (await client.post("/api/surveys", headers=hr)).json()
    survey_id: str = survey["id"]
    await client.put(
        f"/api/surveys/{survey_id}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )
    if open_to_all:
        await client.put(
            f"/api/surveys/{survey_id}/audience/open-to-all", headers=hr, json={"open_to_all": True}
        )
    else:
        rows = audience or [["E2001", "Priya Nair", "", "Engineering", "Pune"]]
        preview = (
            await client.post(
                f"/api/surveys/{survey_id}/audience/uploads",
                headers=hr,
                files={"file": ("a.xlsx", _xlsx(rows), "application/octet-stream")},
            )
        ).json()
        await client.post(
            f"/api/surveys/{survey_id}/audience/uploads/{preview['upload_id']}/apply", headers=hr
        )
    published = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    assert published.status_code == 200, published.text
    return survey_id


async def submit(client: AsyncClient, who: Headers, survey_id: str, answers: dict[str, Any]) -> Any:
    return await client.post(
        f"/api/respond/{survey_id}/submit", headers=who, json={"answers": answers}
    )


async def rows(engine: AsyncEngine, sql: str, **params: Any) -> list[Any]:
    async with engine.connect() as conn:
        return list((await conn.execute(text(sql), params)).all())


# --- access -----------------------------------------------------------------------------------


async def test_people_outside_the_audience_get_403(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, outsider: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)

    for response in (
        await client.get(f"/api/respond/{survey_id}", headers=outsider),
        await client.put(f"/api/respond/{survey_id}/draft", headers=outsider, json={"answers": {}}),
        await submit(client, outsider, survey_id, answers_office()),
    ):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "NOT_IN_AUDIENCE"
        assert response.json()["error"]["message"] == (
            "This survey isn't available to you. If you think that's a mistake, contact HR."
        )


async def test_open_to_all_lets_anyone_respond(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, outsider: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr, open_to_all=True)

    response = await client.get(f"/api/respond/{survey_id}", headers=outsider)

    assert response.status_code == 200


async def test_draft_surveys_are_not_available(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers
) -> None:
    survey = (await client.post("/api/surveys", headers=hr)).json()

    response = await client.get(f"/api/respond/{survey['id']}", headers=priya)

    assert response.status_code == 403


async def test_the_survey_content_and_theme_links(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)

    body = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()

    assert body["version_no"] == 1
    assert body["title"] == PULSE["title"]
    assert [q["key"] for q in body["questions"]] == Q
    assert body["questions"][1]["options"][1] == {"key": HYBRID, "label": "Hybrid"}
    cover = PULSE["theme"]["cover"]
    assert body["assets"][cover]["url"].startswith(f"/api/files/{cover}?exp=")
    assert body["participation"] == {
        "status": "not_started",
        "answers": {},
        "can_edit": False,
        "can_respond_again": False,
        "draft_updated": False,
    }


async def test_not_open_yet_and_closed(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    later = today() + timedelta(days=3)
    future = await publish(
        client,
        hr,
        settings={
            "opens_at": later.isoformat(),
            "closes_at": (later + timedelta(days=5)).isoformat(),
        },
    )
    past = await publish(
        client,
        hr,
        settings={
            "opens_at": (today() - timedelta(days=10)).isoformat(),
            "closes_at": (today() - timedelta(days=1)).isoformat(),
        },
    )

    not_open = await client.get(f"/api/respond/{future}", headers=priya)
    closed = await client.get(f"/api/respond/{past}", headers=priya)

    assert not_open.status_code == 410
    assert not_open.json()["error"]["code"] == "NOT_OPEN_YET"
    assert not_open.json()["error"]["message"] == f"This survey opens on {later.day} {later:%b}."
    assert closed.status_code == 410
    assert closed.json()["error"]["code"] == "SURVEY_CLOSED"
    assert closed.json()["error"]["message"].endswith("Thanks for your interest.")
    # Passing the close date closes the survey.
    detail = (await client.get(f"/api/surveys/{past}", headers=hr)).json()
    assert detail["status"] == "closed"


async def test_manually_closed_surveys_refuse_answers(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    await client.post(f"/api/surveys/{survey_id}/close", headers=hr)

    response = await submit(client, priya, survey_id, answers_office())

    assert response.status_code == 410
    assert response.json()["error"]["message"] == (
        f"This survey closed on {today().day} {today():%b}. Thanks for your interest."
    )


# --- drafts -----------------------------------------------------------------------------------


async def test_draft_resumes_later(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)

    saved = await client.put(
        f"/api/respond/{survey_id}/draft",
        headers=priya,
        json={"answers": {Q[0]: 5, Q[1]: HYBRID, "not-a-question": 1, Q[2]: "not-an-option"}},
    )
    resumed = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()["participation"]

    assert saved.status_code == 200
    assert resumed["status"] == "in_progress"
    assert resumed["answers"] == {Q[0]: 5, Q[1]: HYBRID}  # unknown keys and bad values dropped


async def test_draft_keeps_an_amount_that_is_out_of_range(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)

    await client.put(
        f"/api/respond/{survey_id}/draft", headers=priya, json={"answers": {Q[4]: 600000}}
    )

    resumed = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()
    assert resumed["participation"]["answers"] == {Q[4]: 600000.0}


async def test_draft_from_an_older_version_is_mapped_by_key(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    await client.put(
        f"/api/respond/{survey_id}/draft",
        headers=priya,
        json={"answers": {Q[0]: 5, Q[1]: HYBRID, Q[8]: "Keep this"}},
    )
    draft = copy.deepcopy(PULSE)
    draft["settings"].update(
        {
            "opens_at": (today() - timedelta(days=1)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
        }
    )
    draft["questions"][1]["options"] = [
        o for o in draft["questions"][1]["options"] if o["key"] != HYBRID
    ]
    draft["questions"][2]["condition"] = None  # Q3 no longer depends on the removed option
    draft["questions"].pop(0)  # Q1 removed
    current = (await client.get(f"/api/surveys/{survey_id}", headers=hr)).json()
    await client.put(
        f"/api/surveys/{survey_id}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": current["draft_updated_at"]},
    )
    assert (await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)).status_code == 200

    participation = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()[
        "participation"
    ]

    assert participation["draft_updated"] is True
    assert participation["answers"] == {Q[8]: "Keep this"}


# --- submitting -------------------------------------------------------------------------------


async def test_submit_stores_answers_shown_rows_and_participation(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    await client.put(f"/api/respond/{survey_id}/draft", headers=priya, json={"answers": {Q[0]: 2}})

    response = await submit(client, priya, survey_id, answers_office())

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "submitted"
    (response_row,) = await rows(
        engine,
        "SELECT id, employee_id, department, location FROM survey_responses WHERE survey_id = :s",
        s=survey_id,
    )
    assert (response_row.employee_id, response_row.department, response_row.location) == (
        "E2001",
        "Engineering",
        "Pune",
    )
    shown = await rows(
        engine,
        "SELECT q.key FROM response_shown s JOIN survey_questions q ON q.id = s.question_id "
        "WHERE s.response_id = :r ORDER BY q.sort_order",
        r=response_row.id,
    )
    assert [str(k) for (k,) in shown] == [Q[0], Q[1], Q[5], Q[8]]
    answers = await rows(
        engine,
        "SELECT value_num, value_text, option_id IS NOT NULL AS has_option FROM response_answers "
        "WHERE response_id = :r ORDER BY id",
        r=response_row.id,
    )
    assert len(answers) == 4
    (participation,) = await rows(
        engine,
        "SELECT status, response_id, draft_answers FROM survey_participation WHERE survey_id = :s",
        s=survey_id,
    )
    assert participation.status == "submitted"
    assert participation.response_id == response_row.id
    assert participation.draft_answers == {}


async def test_second_submission_is_refused(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    await submit(client, priya, survey_id, answers_office())

    again = await submit(client, priya, survey_id, answers_office())
    draft = await client.put(f"/api/respond/{survey_id}/draft", headers=priya, json={"answers": {}})
    view = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()["participation"]

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "ALREADY_SUBMITTED"
    assert draft.status_code == 409
    assert view["status"] == "submitted"
    assert view["can_edit"] is False


async def test_hidden_required_questions_dont_block(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    # Q3 ("days in office", required) shows only for Hybrid; Q7 (required) only for managers.
    survey_id = await publish(client, hr)

    response = await submit(client, priya, survey_id, answers_office())

    assert response.status_code == 200


async def test_tampered_answers_to_hidden_questions_are_dropped(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    tampered = answers_office(**{Q[2]: DAYS_3_4, Q[6]: 5, Q[4]: 1000})  # all hidden for Office

    response = await submit(client, priya, survey_id, tampered)

    assert response.status_code == 200
    stored = await rows(
        engine,
        "SELECT q.key FROM response_answers a JOIN survey_questions q ON q.id = a.question_id "
        "JOIN survey_responses r ON r.id = a.response_id WHERE r.survey_id = :s",
        s=survey_id,
    )
    assert {str(k) for (k,) in stored} == {Q[0], Q[1], Q[5], Q[8]}


async def test_visible_problems_come_back_per_question(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)
    answers = {Q[0]: 9, Q[1]: REMOTE, Q[3]: ["nope"], Q[4]: 600000}  # Q6 (required) missing

    response = await submit(client, priya, survey_id, answers)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["message"] == "Check 4 answers before submitting."
    assert error["details"]["issues"] == [
        {"question_key": Q[0], "message": "Choose a rating from 1 to 5."},
        {"question_key": Q[3], "message": "Choose from the options."},
        {"question_key": Q[4], "message": "Enter ₹5,00,000 or less."},
        {"question_key": Q[5], "message": "This question is required."},
    ]


async def test_money_must_be_whole_when_decimals_are_off(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr)

    response = await submit(client, priya, survey_id, answers_office(**{Q[1]: REMOTE, Q[4]: 10.5}))

    assert response.json()["error"]["details"]["issues"] == [
        {"question_key": Q[4], "message": "Enter a whole amount, without paise or cents."}
    ]


async def test_anonymous_responses_keep_no_link_to_the_person(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr, settings={"anonymous": True})

    first = await submit(client, priya, survey_id, answers_office())
    second = await submit(client, priya, survey_id, answers_office())
    mine = await client.get(f"/api/respond/{survey_id}/my-response", headers=priya)

    assert first.status_code == 200
    assert second.status_code == 409  # participation still blocks a second response
    (response_row,) = await rows(
        engine,
        "SELECT employee_id, submitted_at FROM survey_responses WHERE survey_id = :s",
        s=survey_id,
    )
    assert response_row.employee_id is None
    assert (response_row.submitted_at.minute, response_row.submitted_at.second) == (0, 0)
    (participation,) = await rows(
        engine,
        "SELECT response_id, submitted_at FROM survey_participation WHERE survey_id = :s",
        s=survey_id,
    )
    assert participation.response_id is None
    assert participation.submitted_at.minute == 0
    assert mine.status_code == 404


async def test_editing_until_close_updates_the_same_response(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr, settings={"allow_edit": True})
    first = await submit(client, priya, survey_id, answers_office())

    view = (await client.get(f"/api/respond/{survey_id}", headers=priya)).json()["participation"]
    edited = await submit(client, priya, survey_id, answers_office(**{Q[0]: 1}))
    mine = (await client.get(f"/api/respond/{survey_id}/my-response", headers=priya)).json()

    assert first.json()["can_edit"] is True
    assert view["status"] == "submitted"
    assert view["can_edit"] is True
    assert view["answers"] == answers_office()
    assert edited.status_code == 200
    assert mine[Q[0]] == 1
    assert (
        len(await rows(engine, "SELECT id FROM survey_responses WHERE survey_id = :s", s=survey_id))
        == 1
    )


async def test_multiple_responses_when_one_response_is_off(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    survey_id = await publish(client, hr, settings={"one_response": False})

    first = await submit(client, priya, survey_id, answers_office())
    second = await submit(client, priya, survey_id, answers_office())

    assert first.json()["can_respond_again"] is True
    assert second.status_code == 200
    assert (
        len(await rows(engine, "SELECT id FROM survey_responses WHERE survey_id = :s", s=survey_id))
        == 2
    )


# --- my surveys -------------------------------------------------------------------------------


async def test_my_surveys_moves_from_to_do_to_completed(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    priya: Headers,
    outsider: Headers,
    gallery: list[str],
) -> None:
    survey_id = await publish(client, hr)

    pending = (await client.get("/api/me/surveys", headers=priya)).json()
    await client.put(
        f"/api/respond/{survey_id}/draft", headers=priya, json={"answers": {Q[0]: 3, Q[1]: OFFICE}}
    )
    in_progress = (await client.get("/api/me/surveys", headers=priya)).json()
    await submit(client, priya, survey_id, answers_office())
    done = (await client.get("/api/me/surveys", headers=priya)).json()
    outsiders = (await client.get("/api/me/surveys", headers=outsider)).json()

    assert [(s["id"], s["status"]) for s in pending] == [(survey_id, "pending")]
    assert pending[0]["minutes"] == 1  # 4 visible questions x 20 s
    assert pending[0]["closes_at"] == (today() + timedelta(days=7)).isoformat()
    assert pending[0]["cover"]["mobile_url"].startswith("/api/files/")
    assert in_progress[0]["status"] == "in_progress"
    assert in_progress[0]["progress"] == 0.5  # 2 of the 4 visible questions answered
    assert done[0]["status"] == "submitted"
    assert done[0]["submitted_at"]
    assert outsiders == []


async def test_closed_surveys_drop_off_unless_you_responded(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, priya: Headers, gallery: list[str]
) -> None:
    answered = await publish(client, hr)
    missed = await publish(client, hr)
    await submit(client, priya, answered, answers_office())
    for survey_id in (answered, missed):
        await client.post(f"/api/surveys/{survey_id}/close", headers=hr)

    listed = (await client.get("/api/me/surveys", headers=priya)).json()

    assert [(s["id"], s["status"], s["open"]) for s in listed] == [(answered, "submitted", False)]


# --- respondent names ---------------------------------------------------------------------------


async def test_open_to_all_reports_use_the_name_people_signed_in_with(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    token_for: Callable[..., str],
    gallery: list[str],
) -> None:
    survey_id = await publish(client, hr, open_to_all=True)
    kavya = bearer(token_for("W2001", "employee", "Kavya Menon"))
    assert (await submit(client, kavya, survey_id, answers_office())).status_code == 200

    listed = await client.get(f"/api/surveys/{survey_id}/results/responses", headers=hr)
    export = await client.get(
        f"/api/surveys/{survey_id}/results/export.xlsx", headers=hr, params={"kind": "responses"}
    )
    sheet = load_workbook(io.BytesIO(export.content))["Responses"]

    assert listed.json()["items"][0]["name"] == "Kavya Menon"
    assert [sheet["B6"].value, sheet["C6"].value] == ["W2001", "Kavya Menon"]
    assert sheet["A2"].value == "1 response (open to all employees)"


async def test_the_audience_list_name_wins_over_the_sign_in_name(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    token_for: Callable[..., str],
    gallery: list[str],
) -> None:
    survey_id = await publish(client, hr)  # audience: E2001 "Priya Nair"
    signed_in_as = bearer(token_for("E2001", "employee", "P. Nair"))
    await submit(client, signed_in_as, survey_id, answers_office())

    listed = await client.get(f"/api/surveys/{survey_id}/results/responses", headers=hr)

    assert listed.json()["items"][0]["name"] == "Priya Nair"
    assert await rows(engine, "SELECT name FROM survey_responses") == [("P. Nair",)]


async def test_anonymous_responses_store_no_name(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    priya: Headers,
    gallery: list[str],
) -> None:
    survey_id = await publish(client, hr, settings={"anonymous": True})
    await submit(client, priya, survey_id, answers_office())

    assert await rows(engine, "SELECT employee_id, name FROM survey_responses") == [(None, None)]
