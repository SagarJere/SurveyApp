"""Number questions from end to end: settings, publish checks, answers, conditions, results
and the Excel export."""

import io
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.services.results import number_distribution
from app.tests.conftest import bearer

Headers = dict[str, str]


def today() -> date:
    # Survey dates are calendar days in SURVEY_TIMEZONE (Asia/Kolkata by default).
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


S1 = str(uuid.uuid4())
PEOPLE = str(uuid.uuid4())  # "How many people are coming?" whole numbers 1-10
FOLLOW_UP = str(uuid.uuid4())  # shown when 3 or more are coming
DISTANCE = str(uuid.uuid4())  # decimals, no limits, unit "km"


def number_question(key: str, text_: str, config: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "key": key,
        "section_key": S1,
        "type": "number",
        "text": text_,
        "help": "",
        "required": False,
        "options": [],
        "config": config,
        "condition": None,
        **extra,
    }


def draft(people_config: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "title": "Family Unity Run",
        "description": "",
        "settings": {
            "layout": "all",
            "allow_edit": True,  # so a submitted response's answers come back
            "opens_at": (today() - timedelta(days=1)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
        },
        "sections": [{"key": S1, "title": "", "description": "", "condition": None}],
        "questions": [
            number_question(
                PEOPLE,
                "How many people are coming?",
                people_config
                or {
                    "number_min": 1,
                    "number_max": 10,
                    "number_decimals": False,
                    "number_unit": "people",
                },
                required=True,
            ),
            {
                **number_question(FOLLOW_UP, "Do you need a car park pass?", {}),
                "type": "short",
                "condition": {"src": PEOPLE, "op": "gte", "val": 3},
            },
            number_question(
                DISTANCE,
                "How far will you travel?",
                {"number_decimals": True, "number_unit": "km"},
            ),
        ],
    }


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def person(token_for: Callable[..., str]) -> Callable[[str], Headers]:
    return lambda employee_id: bearer(token_for(employee_id, "employee", f"Person {employee_id}"))


async def save(client: AsyncClient, hr: Headers, body: dict[str, Any]) -> tuple[str, Any]:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    response = await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": body, "draft_updated_at": survey["draft_updated_at"]},
    )
    return survey["id"], response


async def publish(client: AsyncClient, hr: Headers, body: dict[str, Any] | None = None) -> str:
    survey_id, saved = await save(client, hr, body or draft())
    assert saved.status_code == 200, saved.text
    await client.put(
        f"/api/surveys/{survey_id}/audience/open-to-all", headers=hr, json={"open_to_all": True}
    )
    published = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    assert published.status_code == 200, published.text
    return survey_id


async def submit(client: AsyncClient, who: Headers, survey_id: str, answers: dict[str, Any]) -> Any:
    return await client.post(
        f"/api/respond/{survey_id}/submit", headers=who, json={"answers": answers}
    )


# --- settings and publishing -------------------------------------------------------------------


async def test_settings_allow_negatives_and_keep_money_settings(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    body = draft({"number_min": -40, "number_max": 50, "currency": "USD", "decimals": True})
    survey_id, saved = await save(client, hr, body)

    assert saved.status_code == 200, saved.text
    # Switching between Money and Number keeps both types' settings.
    stored = (await client.get(f"/api/surveys/{survey_id}", headers=hr)).json()
    config = stored["draft"]["questions"][0]["config"]
    assert config["number_min"] == -40
    assert config["currency"] == "USD"


@pytest.mark.parametrize(
    "config",
    [
        {"number_unit": "x" * 31},
        {"number_min": 1_000_000_000_000},
        {"number_max": "ten"},
    ],
)
async def test_settings_out_of_bounds_are_refused(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, config: dict[str, Any]
) -> None:
    _, saved = await save(client, hr, draft(config))
    assert saved.status_code == 422


async def test_publishing_needs_min_below_max(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id, _ = await save(client, hr, draft({"number_min": 10, "number_max": 1}))
    issues = (await client.post(f"/api/surveys/{survey_id}/validate", headers=hr)).json()["issues"]
    # (It also has no audience yet; that's reported separately.)
    assert [i["code"] for i in issues if i["question_key"]] == ["number_range"]
    assert issues[0]["message"] == "Q1 has a minimum larger than its maximum."


async def test_published_version_keeps_only_number_settings(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    body = draft({"number_min": 1, "number_max": 10, "number_unit": "people", "currency": "USD"})
    survey_id = await publish(client, hr, body)

    survey = (await client.get(f"/api/respond/{survey_id}", headers=person("W1"))).json()
    assert survey["questions"][0]["config"] == {
        "number_min": 1,
        "number_max": 10,
        "number_decimals": False,
        "number_unit": "people",
    }


# --- answering ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        (2.5, "Enter a whole number."),
        (11, "Enter a number from 1 to 10."),
        (0, "Enter a number from 1 to 10."),
        ("3", "Enter a number."),
        (True, "Enter a number."),
    ],
)
async def test_answers_are_checked_on_submit(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    person: Callable[[str], Headers],
    answer: Any,
    message: str,
) -> None:
    survey_id = await publish(client, hr)

    response = await submit(client, person("W1"), survey_id, {PEOPLE: answer})

    assert response.status_code == 422
    assert response.json()["error"]["details"]["issues"] == [
        {"question_key": PEOPLE, "message": message}
    ]


async def test_condition_on_a_number_and_stored_values(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await publish(client, hr)

    few = await submit(client, person("W1"), survey_id, {PEOPLE: 2, FOLLOW_UP: "Yes", DISTANCE: 4})
    many = await submit(
        client, person("W2"), survey_id, {PEOPLE: 4, FOLLOW_UP: "Yes", DISTANCE: 12.345}
    )

    assert few.status_code == 200, few.text
    assert many.status_code == 200, many.text
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT r.employee_id, q.type, a.value_num, a.value_text"
                    " FROM response_answers a"
                    " JOIN survey_responses r ON r.id = a.response_id"
                    " JOIN survey_questions q ON q.id = a.question_id"
                    " ORDER BY r.employee_id, q.sort_order"
                )
            )
        ).all()
    assert [tuple(row) for row in rows] == [
        # 2 people: the car park question was hidden, so its answer was dropped.
        ("W1", "number", Decimal("2.00"), None),
        ("W1", "number", Decimal("4.00"), None),
        ("W2", "number", Decimal("4.00"), None),
        ("W2", "short", None, "Yes"),
        ("W2", "number", Decimal("12.35"), None),  # rounded to 2 decimals
    ]

    # Answers come back as numbers: whole numbers without a decimal point.
    again = (await client.get(f"/api/respond/{survey_id}", headers=person("W2"))).json()
    assert again["participation"]["answers"][PEOPLE] == 4
    assert again["participation"]["answers"][DISTANCE] == 12.35


# --- results and export ------------------------------------------------------------------------


async def test_results_and_export(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await publish(client, hr)
    for i, (people, km) in enumerate([(1, 2.5), (2, 10), (2, 7.25), (4, 30), (6, 0)]):
        response = await submit(client, person(f"W{i}"), survey_id, {PEOPLE: people, DISTANCE: km})
        assert response.status_code == 200, response.text

    results = (await client.get(f"/api/surveys/{survey_id}/results/questions", headers=hr)).json()
    questions = {q["key"]: q for q in results["sections"][0]["questions"]}
    people_q = questions[PEOPLE]
    assert people_q["unit"] == "people"
    assert people_q["stats"] == {
        "total": 15.0,
        "average": 3.0,
        "median": 2.0,
        "min": 1.0,
        "max": 6.0,
        "average_words": None,
        "median_words": None,
    }
    # Few different answers: one bar per value, out of the people who answered.
    assert people_q["ranges"] == [
        {"label": "1 people", "n": 1, "share": 0.2},
        {"label": "2 people", "n": 2, "share": 0.4},
        {"label": "4 people", "n": 1, "share": 0.2},
        {"label": "6 people", "n": 1, "share": 0.2},
    ]
    assert questions[DISTANCE]["stats"]["total"] == 49.75

    export = await client.get(
        f"/api/surveys/{survey_id}/results/export.xlsx", headers=hr, params={"kind": "analytics"}
    )
    book = load_workbook(io.BytesIO(export.content))
    sheet = book["Responses"]
    header = [c.value for c in sheet[5]]
    people_col = header.index("Q1. How many people are coming? (people)") + 1
    km_col = header.index("Q3. How far will you travel? (km)") + 1
    people_cells = [sheet.cell(row=r, column=people_col) for r in range(6, sheet.max_row + 1)]
    assert sorted(c.value for c in people_cells) == [1, 2, 2, 4, 6]  # numbers, not text
    assert people_cells[0].number_format == "#,##0"
    assert sheet.cell(row=6, column=km_col).number_format == "#,##0.00"
    # The Summary sheet has the figures and a chart for each number question.
    summary_values = [row[0].value for row in book["Summary"].iter_rows()]
    assert "Total" in summary_values
    assert len(book["Summary"]._charts) == 2


def test_distribution_groups_many_values_into_five_ranges() -> None:
    whole = [(Decimal(v), 1) for v in range(1, 21)]  # 1..20, twenty different answers
    assert number_distribution(whole, 20, "km") == [
        {"label": "1–4 km", "n": 4, "share": 0.2},  # noqa: RUF001
        {"label": "5–8 km", "n": 4, "share": 0.2},  # noqa: RUF001
        {"label": "9–12 km", "n": 4, "share": 0.2},  # noqa: RUF001
        {"label": "13–16 km", "n": 4, "share": 0.2},  # noqa: RUF001
        {"label": "17–20 km", "n": 4, "share": 0.2},  # noqa: RUF001
    ]
    decimals = [(Decimal("0.5") * i, 1) for i in range(11)]  # 0, 0.5 … 5, eleven answers
    labels = [r["label"] for r in number_distribution(decimals, 11)]
    assert labels == ["0–1", "1–2", "2–3", "3–4", "4–5"]  # noqa: RUF001
    assert sum(r["n"] for r in number_distribution(decimals, 11)) == 11
    assert number_distribution([], 0) == []
