"""Results checked against hand-written SQL (docs/08, Phase 5 "Done when")."""

import copy
import io
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.scripts.seed_responses import seed_responses
from app.tests.conftest import bearer

PULSE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/workplace-pulse.json").read_text()
)["draft"]
Q = [q["key"] for q in PULSE["questions"]]
HYBRID = PULSE["questions"][1]["options"][1]["key"]
TZ = "Asia/Kolkata"

Headers = dict[str, str]


def today() -> date:
    return datetime.now(ZoneInfo(TZ)).date()


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def viewer(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1003", "hr"))


async def make_survey(
    client: AsyncClient, hr: Headers, settings: dict[str, Any] | None = None
) -> str:
    draft = copy.deepcopy(PULSE)
    draft["settings"].update(
        {
            "opens_at": (today() - timedelta(days=20)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
            **(settings or {}),
        }
    )
    survey = (await client.post("/api/surveys", headers=hr)).json()
    await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )

    # A placeholder audience member so the survey can be published; seeding adds the rest.
    async def publish() -> None:
        response = await client.post(f"/api/surveys/{survey['id']}/publish", headers=hr)
        assert response.status_code == 200, response.text

    form = {"file": ("a.csv", b"EmployeeId,Department\nE0001,Legal\n", "text/csv")}
    preview = (
        await client.post(f"/api/surveys/{survey['id']}/audience/uploads", headers=hr, files=form)
    ).json()
    await client.post(
        f"/api/surveys/{survey['id']}/audience/uploads/{preview['upload_id']}/apply", headers=hr
    )
    await publish()
    survey_id: str = survey["id"]
    return survey_id


async def seed(app: FastAPI, survey_id: str, count: int, **kwargs: Any) -> None:
    import uuid  # noqa: PLC0415

    settings: Settings = app.state.settings
    async with app.state.sessionmaker() as session:
        await seed_responses(session, settings, uuid.UUID(survey_id), count, **kwargs)


async def sql(engine: AsyncEngine, query: str, **params: Any) -> list[Any]:
    async with engine.connect() as conn:
        return list((await conn.execute(text(query), params)).all())


async def scalar(engine: AsyncEngine, query: str, **params: Any) -> Any:
    rows = await sql(engine, query, **params)
    return rows[0][0]


async def get(client: AsyncClient, hr: Headers, survey_id: str, path: str, **params: Any) -> Any:
    response = await client.get(
        f"/api/surveys/{survey_id}/results/{path}", headers=hr, params=params
    )
    assert response.status_code == 200, response.text
    return response.json()


# Hand-written SQL: answers to a question (by key) across versions, for one survey.
ANSWERS = """
    FROM response_answers a
    JOIN survey_questions q ON q.id = a.question_id
    JOIN survey_responses r ON r.id = a.response_id
    WHERE r.survey_id = :s AND q.key = :k
"""


SHOWN = """
    FROM response_shown sh
    JOIN survey_questions q ON q.id = sh.question_id
    JOIN survey_responses r ON r.id = sh.response_id
    WHERE r.survey_id = :s AND q.key = :k
"""
OPTION_COUNTS = (
    "SELECT o.key::text, count(*) FROM response_answers a "
    "JOIN question_options o ON o.id = a.option_id "
    "JOIN survey_questions q ON q.id = a.question_id "
    "JOIN survey_responses r ON r.id = a.response_id "
    "WHERE r.survey_id = :s AND q.key = :k GROUP BY o.key"
)
MONEY_STATS = (
    "SELECT sum(a.value_num), avg(a.value_num), "
    "percentile_cont(0.5) WITHIN GROUP (ORDER BY a.value_num), "
    f"min(a.value_num), max(a.value_num) {ANSWERS}"
)
MONEY_BUCKETS = (
    "SELECT count(*) FILTER (WHERE a.value_num < 10000), "
    "count(*) FILTER (WHERE a.value_num >= 10000 AND a.value_num < 25000), "
    "count(*) FILTER (WHERE a.value_num >= 25000 AND a.value_num < 50000), "
    "count(*) FILTER (WHERE a.value_num >= 50000 AND a.value_num < 100000), "
    f"count(*) FILTER (WHERE a.value_num >= 100000) {ANSWERS}"
)
TEXT_ANSWERS = (
    "SELECT count(*) FROM response_answers a JOIN survey_questions q ON q.id = a.question_id "
    "JOIN survey_responses r ON r.id = a.response_id "
    "WHERE r.survey_id = :s AND q.type IN ('short', 'long')"
)


@dataclass
class Ctx:
    client: AsyncClient
    engine: AsyncEngine
    hr: Headers
    s: str

    async def get(self, path: str, **params: Any) -> Any:
        return await get(self.client, self.hr, self.s, path, **params)

    async def one(self, query: str, **params: Any) -> Any:
        return await scalar(self.engine, query, s=self.s, **params)

    async def rows(self, query: str, **params: Any) -> list[Any]:
        return await sql(self.engine, query, s=self.s, **params)


async def check_headline(ctx: Ctx) -> dict[str, int]:
    summary = await ctx.get("summary")
    totals = {
        "responses": await ctx.one("SELECT count(*) FROM survey_responses WHERE survey_id = :s"),
        "invited": await ctx.one("SELECT count(*) FROM survey_audience WHERE survey_id = :s"),
        "submitted": await ctx.one(
            "SELECT count(*) FROM survey_participation "
            "WHERE survey_id = :s AND status = 'submitted'"
        ),
        "week": await ctx.one(
            "SELECT count(*) FROM survey_responses WHERE survey_id = :s "
            "AND (submitted_at AT TIME ZONE :tz)::date >= :d",
            tz=TZ,
            d=today() - timedelta(days=6),
        ),
    }
    assert totals["responses"] == 420
    assert summary["responses"] == totals["responses"]
    assert summary["invited"] == totals["invited"]
    assert summary["response_rate"] == round(totals["submitted"] / totals["invited"], 4)
    avg_q1 = await ctx.one(f"SELECT avg(a.value_num) {ANSWERS}", k=Q[0])
    assert summary["headline"]["average"] == round(float(avg_q1), 2)
    median_q5 = await ctx.one(
        f"SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.value_num) {ANSWERS}", k=Q[4]
    )
    assert summary["money"]["median"] == round(float(median_q5), 2)
    assert summary["responses_this_week"] == totals["week"]
    assert summary["small_group"] is False
    return totals


async def check_timeline(ctx: Ctx, responses: int) -> None:
    timeline = await ctx.get("timeline")
    per_day = dict(
        await ctx.rows(
            "SELECT (submitted_at AT TIME ZONE :tz)::date AS d, count(*) FROM survey_responses "
            "WHERE survey_id = :s GROUP BY d",
            tz=TZ,
        )
    )
    api_days = {date.fromisoformat(d["day"]): d["n"] for d in timeline["days"]}
    assert {d: n for d, n in api_days.items() if n} == per_day
    assert sum(api_days.values()) == responses
    days = sorted(api_days)
    assert days == [days[0] + timedelta(days=i) for i in range(len(days))]  # no gaps


async def check_participation(ctx: Ctx) -> None:
    participation = await ctx.get("participation")
    expected = {
        dept: (invited, responded)
        for dept, invited, responded in await ctx.rows(
            "SELECT a.department, count(*), count(p.employee_id) FROM survey_audience a "
            "LEFT JOIN survey_participation p ON p.survey_id = a.survey_id "
            "AND p.employee_id = a.employee_id AND p.status = 'submitted' "
            "WHERE a.survey_id = :s GROUP BY a.department"
        )
    }
    got = {d["department"]: (d["invited"], d["responded"]) for d in participation["departments"]}
    assert got == expected


async def check_choice(ctx: Ctx, widget: dict[str, Any], shown: int) -> None:
    counts = dict(await ctx.rows(OPTION_COUNTS, k=widget["key"]))
    for option in widget["options"]:
        assert option["n"] == counts.get(option["key"], 0)
        # The denominator is the people shown the question, not all respondents.
        assert option["share"] == round(option["n"] / shown, 4)


async def check_rating(ctx: Ctx, widget: dict[str, Any]) -> None:
    key = widget["key"]
    dist = dict(await ctx.rows(f"SELECT a.value_num::int, count(*) {ANSWERS} GROUP BY 1", k=key))
    assert [d["n"] for d in widget["distribution"]] == [dist.get(v, 0) for v in range(1, 6)]
    avg = await ctx.one(f"SELECT avg(a.value_num) {ANSWERS}", k=key)
    assert widget["average"] == round(float(avg), 2)


async def check_money(ctx: Ctx, widget: dict[str, Any]) -> None:
    key = widget["key"]
    total, average, median, low, high = (await ctx.rows(MONEY_STATS, k=key))[0]
    stats = widget["stats"]
    assert stats["total"] == round(float(total), 2)
    assert stats["average"] == round(float(average), 2)
    assert stats["median"] == round(float(median), 2)
    assert (stats["min"], stats["max"]) == (round(float(low), 2), round(float(high), 2))
    assert stats["median_words"].endswith("only")
    buckets = await ctx.rows(MONEY_BUCKETS, k=key)
    assert [r["n"] for r in widget["ranges"]] == list(buckets[0])
    assert [r["label"] for r in widget["ranges"]] == [
        "Under ₹10,000",
        "₹10,000–25,000",  # noqa: RUF001
        "₹25,000–50,000",  # noqa: RUF001
        "₹50,000–1,00,000",  # noqa: RUF001
        "₹1,00,000 and above",
    ]


async def check_widgets(ctx: Ctx) -> None:
    result = await ctx.get("questions")
    widgets = {q["key"]: q for section in result["sections"] for q in section["questions"]}
    assert [q["number"] for q in widgets.values()] == list(range(1, 10))
    for key, widget in widgets.items():
        shown = await ctx.one(f"SELECT count(*) {SHOWN}", k=key)
        answered = await ctx.one(f"SELECT count(DISTINCT a.response_id) {ANSWERS}", k=key)
        assert (widget["shown"], widget["answered"]) == (shown, answered), widget["text"]
        if widget["type"] in ("single", "multi", "dropdown"):
            await check_choice(ctx, widget, shown)
        elif widget["type"] == "rating":
            await check_rating(ctx, widget)
        elif widget["type"] == "money":
            await check_money(ctx, widget)
    # Checkboxes: shares can add up to more than 100% (people pick several).
    assert sum(o["share"] for o in widgets[Q[3]]["options"]) > 1


async def check_comments(ctx: Ctx) -> int:
    comments = await ctx.get("comments")
    texts: int = await ctx.one(TEXT_ANSWERS)
    assert comments["total"] == texts
    assert len(comments["items"]) == 20
    assert comments["items"][0]["employee"]["employee_id"].startswith("T")
    return texts


async def check_filters_and_small_group(ctx: Ctx) -> None:
    engineering = await ctx.get("summary", department="Engineering")
    assert engineering["responses"] == await ctx.one(
        "SELECT count(*) FROM survey_responses WHERE survey_id = :s AND department = 'Engineering'"
    )
    filtered = await ctx.get("questions", department="Engineering")
    q2 = next(q for sec in filtered["sections"] for q in sec["questions"] if q["key"] == Q[1])
    assert q2["answered"] == await ctx.one(
        f"SELECT count(DISTINCT a.response_id) {ANSWERS} AND r.department = 'Engineering'", k=Q[1]
    )

    # Legal has 3 responses. This survey isn't anonymous, so the small-group rule doesn't apply:
    # HR already sees who answered, and every answer is reported however few there are.
    legal_summary = await ctx.get("summary", department="Legal")
    legal_questions = await ctx.get("questions", department="Legal")
    legal_comments = await ctx.get("comments", department="Legal")
    assert legal_summary["responses"] == 3
    assert legal_summary["small_group"] is False
    assert legal_questions["small_group"] is False
    legal_q2 = next(
        q for sec in legal_questions["sections"] for q in sec["questions"] if q["key"] == Q[1]
    )
    assert legal_q2["answered"] == await ctx.one(
        f"SELECT count(DISTINCT a.response_id) {ANSWERS} AND r.department = 'Legal'", k=Q[1]
    )
    assert legal_comments["small_group"] is False
    assert legal_summary["invited"] == await ctx.one(
        "SELECT count(*) FROM survey_audience WHERE survey_id = :s AND department = 'Legal'"
    )


async def check_export(ctx: Ctx, responses: int, texts: int) -> None:
    export = await ctx.client.get(f"/api/surveys/{ctx.s}/results/export.xlsx", headers=ctx.hr)
    workbook = load_workbook(io.BytesIO(export.content))
    assert workbook.sheetnames == [
        "Summary",
        "Participation",
        "Responses per day",
        "Responses",
        "Comments",
    ]
    # A bar chart for every choice, rating and money question, plus participation and daily.
    charted = sum(1 for q in PULSE["questions"] if q["type"] not in ("short", "long"))
    assert len(workbook["Summary"]._charts) == charted
    assert len(workbook["Participation"]._charts) == 1
    assert len(workbook["Responses per day"]._charts) == 1
    assert "analytics" in export.headers["content-disposition"]
    sheet = workbook["Responses"]
    header = [c.value for c in sheet[1]]
    money_col = header.index(f"Q5. {PULSE['questions'][4]['text']}")
    assert header[money_col + 1] == "Q5 in words"
    assert sheet.max_row == responses + 1
    money_cells = [
        row[money_col] for row in sheet.iter_rows(min_row=2) if row[money_col].value is not None
    ]
    assert money_cells
    assert all(isinstance(c.value, int | float) for c in money_cells)  # numeric, not text
    assert "₹" in money_cells[0].number_format
    words = sheet.cell(row=money_cells[0].row, column=money_col + 2).value
    assert isinstance(words, str)
    assert words.endswith("only")
    assert workbook["Comments"].max_row == texts + 1

    # Responses only: one sheet, the same rows and columns as the analytics file's Responses.
    plain = await ctx.client.get(
        f"/api/surveys/{ctx.s}/results/export.xlsx", headers=ctx.hr, params={"kind": "responses"}
    )
    plain_book = load_workbook(io.BytesIO(plain.content))
    assert plain_book.sheetnames == ["Responses"]
    assert [c.value for c in plain_book["Responses"][1]] == header
    assert plain_book["Responses"].max_row == responses + 1
    assert "responses" in plain.headers["content-disposition"]

    # A named survey exports every answer even for a group of 3.
    legal = await ctx.client.get(
        f"/api/surveys/{ctx.s}/results/export.xlsx",
        headers=ctx.hr,
        params={"department": "Legal", "kind": "responses"},
    )
    assert load_workbook(io.BytesIO(legal.content))["Responses"].max_row == 3 + 1

    bad = await ctx.client.get(
        f"/api/surveys/{ctx.s}/results/export.xlsx", headers=ctx.hr, params={"kind": "pdf"}
    )
    assert bad.status_code == 422


async def check_non_responders_and_home(ctx: Ctx, totals: dict[str, int]) -> None:
    response = await ctx.client.get(
        f"/api/surveys/{ctx.s}/results/non-responders.xlsx", headers=ctx.hr
    )
    sheet = load_workbook(io.BytesIO(response.content)).active
    assert sheet is not None
    assert sheet.max_row - 1 == totals["invited"] - totals["submitted"]

    listed = next(
        i for i in (await ctx.client.get("/api/surveys", headers=ctx.hr)).json() if i["id"] == ctx.s
    )
    assert listed["response_count"] == totals["responses"]
    assert listed["audience_count"] == totals["invited"]
    assert listed["response_rate"] == round(totals["submitted"] / totals["invited"], 4)
    assert listed["responses_this_week"] == totals["week"]


async def test_every_widget_matches_hand_written_sql(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr)
    await seed(app, survey_id, 420, first_department=("Legal", 3))
    ctx = Ctx(client, engine, hr, survey_id)

    totals = await check_headline(ctx)
    await check_timeline(ctx, totals["responses"])
    await check_participation(ctx)
    await check_widgets(ctx)
    texts = await check_comments(ctx)
    await check_filters_and_small_group(ctx)
    await check_export(ctx, totals["responses"], texts)
    await check_non_responders_and_home(ctx, totals)


async def test_filter_by_answer_and_dates(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr)
    await seed(app, survey_id, 60)

    hybrid = await get(client, hr, survey_id, "summary", **{f"q_{Q[1]}": HYBRID})
    expected = await scalar(
        engine,
        "SELECT count(DISTINCT r.id) FROM survey_responses r "
        "JOIN response_answers a ON a.response_id = r.id "
        "JOIN question_options o ON o.id = a.option_id WHERE r.survey_id = :s AND o.key = :o",
        s=survey_id,
        o=HYBRID,
    )
    assert hybrid["responses"] == expected

    since = today() - timedelta(days=2)
    recent = await get(client, hr, survey_id, "timeline", **{"from": since.isoformat()})
    assert recent["days"][0]["day"] == since.isoformat()


async def test_anonymous_survey_hides_answers_until_five_responses(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr, {"anonymous": True})
    await seed(app, survey_id, 4)

    before = await get(client, hr, survey_id, "questions")
    summary = await get(client, hr, survey_id, "summary")
    comments = await get(client, hr, survey_id, "comments")
    analytics = load_workbook(
        io.BytesIO(
            (await client.get(f"/api/surveys/{survey_id}/results/export.xlsx", headers=hr)).content
        )
    )
    plain = load_workbook(
        io.BytesIO(
            (
                await client.get(
                    f"/api/surveys/{survey_id}/results/export.xlsx",
                    headers=hr,
                    params={"kind": "responses"},
                )
            ).content
        )
    )
    await seed(app, survey_id, 1, seed=99)
    after = await get(client, hr, survey_id, "questions")  # submit cleared the cache

    # Answers are left out of the API payload itself, and out of both exports.
    assert before == {"small_group": True, "responses": 4, "sections": []}
    assert summary["small_group"] is True
    assert summary["headline"] is None
    assert summary["money"] is None
    assert comments["items"] == []
    assert analytics.sheetnames == ["Summary", "Participation", "Responses per day"]
    assert plain.sheetnames == ["Responses"]
    assert "Fewer than 5 people" in str(plain["Responses"]["A4"].value)
    assert after["small_group"] is False
    assert after["responses"] == 5


async def test_named_survey_shows_answers_from_the_first_response(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr)
    await seed(app, survey_id, 2)

    questions = await get(client, hr, survey_id, "questions")
    export = await client.get(
        f"/api/surveys/{survey_id}/results/export.xlsx", headers=hr, params={"kind": "responses"}
    )
    sheet = load_workbook(io.BytesIO(export.content))["Responses"]

    assert questions["small_group"] is False
    assert questions["responses"] == 2
    assert questions["sections"]
    assert sheet.max_row == 2 + 1
    assert sheet["B1"].value == "Employee ID"


async def test_anonymous_results_show_no_names(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr, {"anonymous": True})
    await seed(app, survey_id, 12)

    responses = await client.get(f"/api/surveys/{survey_id}/results/responses", headers=hr)
    comments = await get(client, hr, survey_id, "comments")
    summary = await get(client, hr, survey_id, "summary")
    export = await client.get(f"/api/surveys/{survey_id}/results/export.xlsx", headers=hr)
    header = [c.value for c in load_workbook(io.BytesIO(export.content))["Responses"][1]]

    assert responses.status_code == 403
    assert all(item["employee"] is None for item in comments["items"])
    assert summary["anonymous"] is True
    assert "Employee ID" not in header
    assert "Name" not in header


async def test_individual_responses_for_named_surveys(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr)
    await seed(app, survey_id, 6)

    page = await get(client, hr, survey_id, "responses")
    detail = await get(client, hr, survey_id, f"responses/{page['items'][0]['id']}")

    assert page["total"] == 6
    assert page["items"][0]["employee_id"].startswith("T")
    assert detail["answers"][0]["number"] == 1
    assert detail["answers"][0]["answer"].endswith("/ 5")
    keys = [a["key"] for a in detail["answers"]]
    assert Q[1] in keys  # Q2 is always shown


async def test_results_need_a_published_survey_and_access(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, viewer: Headers, gallery: list[str]
) -> None:
    draft_only = (await client.post("/api/surveys", headers=hr)).json()["id"]
    published = await make_survey(client, hr)

    not_published = await client.get(f"/api/surveys/{draft_only}/results/summary", headers=hr)
    stranger = await client.get(f"/api/surveys/{published}/results/summary", headers=viewer)
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO survey_members VALUES (:id, 'E1003', 'viewer')"), {"id": published}
        )
    as_viewer = await client.get(f"/api/surveys/{published}/results/summary", headers=viewer)
    viewer_nonresp = await client.get(
        f"/api/surveys/{published}/results/non-responders.xlsx", headers=viewer
    )
    bad_filter = await client.get(
        f"/api/surveys/{published}/results/summary", headers=hr, params={"from": "soon"}
    )

    assert not_published.status_code == 409
    assert stranger.status_code == 404
    assert as_viewer.status_code == 200
    assert as_viewer.json()["can_download_non_responders"] is False
    assert viewer_nonresp.status_code == 403
    assert bad_filter.status_code == 422


async def test_versions_combine_by_key(
    client: AsyncClient, engine: AsyncEngine, app: FastAPI, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await make_survey(client, hr)
    await seed(app, survey_id, 6)
    current = (await client.get(f"/api/surveys/{survey_id}", headers=hr)).json()
    edited = copy.deepcopy(current["draft"])
    edited["questions"][0]["text"] = "How happy are you with your setup?"
    await client.put(
        f"/api/surveys/{survey_id}/draft",
        headers=hr,
        json={"draft": edited, "draft_updated_at": current["draft_updated_at"]},
    )
    await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    await seed(app, survey_id, 5, seed=3)

    combined = await get(client, hr, survey_id, "questions")
    only_v2 = await get(client, hr, survey_id, "questions", version=2)
    summary = await get(client, hr, survey_id, "summary")

    q1 = combined["sections"][0]["questions"][0]
    assert q1["text"] == "How happy are you with your setup?"
    assert q1["answered"] == 11  # both versions, combined by question key
    assert only_v2["responses"] == 5
    assert summary["compatible_versions"] is True
    assert [v["responses"] for v in summary["versions"]] == [6, 5]
