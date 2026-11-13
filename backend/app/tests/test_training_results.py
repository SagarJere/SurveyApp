"""Phase T3: training results and the completion report, checked against hand-written SQL on a
seeded training of 420 people with mixed attempts (docs/08-implementation-plan.md, T3)."""

import io
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.scripts.seed_training_results import seed_training_results
from app.tests.conftest import bearer

Headers = dict[str, str]
ZONE = ZoneInfo("Asia/Kolkata")
PEOPLE = 420

S1, S2 = str(uuid.uuid4()), str(uuid.uuid4())
QS, QM, QN, QC, QF = (str(uuid.uuid4()) for _ in range(5))
A, B, M1, M2, M3, C1, C2 = (str(uuid.uuid4()) for _ in range(7))


def today() -> date:
    return datetime.now(ZONE).date()


DUE = today() - timedelta(days=5)


def training_draft() -> dict[str, Any]:
    video = {"source": "link", "allow_seek": False, "allow_speed": False}
    return {
        "title": "Fire safety basics",
        "description": "",
        "settings": {
            "layout": "all",
            "opens_at": (today() - timedelta(days=20)).isoformat(),
            "closes_at": (today() + timedelta(days=20)).isoformat(),
            "due_date": DUE.isoformat(),
            "quiz": {"pass_mark": 70, "retakes": "limit", "max_attempts": 3},
        },
        "sections": [
            {
                "key": S1,
                "title": "Preventing fires",
                "description": "",
                "condition": None,
                "video": {**video, "url": "https://videos.example/one.mp4"},
            },
            {
                "key": S2,
                "title": "Evacuation",
                "description": "",
                "condition": None,
                "video": {**video, "url": "https://videos.example/two.mp4"},
            },
        ],
        "questions": [
            {
                "key": QS,
                "section_key": S1,
                "type": "single",
                "text": "What should you do first?",
                "required": True,
                "options": [{"key": A, "label": "Raise the alarm"}, {"key": B, "label": "Run"}],
                "quiz": {"points": 2, "correct_options": [A]},
            },
            {
                "key": QM,
                "section_key": S1,
                "type": "multi",
                "text": "Which are fire classes?",
                "options": [
                    {"key": M1, "label": "Class A"},
                    {"key": M2, "label": "Class Z"},
                    {"key": M3, "label": "Class B"},
                ],
                "quiz": {"points": 1, "correct_options": [M1, M3]},
            },
            {
                "key": QN,
                "section_key": S2,
                "type": "number",
                "text": "How many metres away is the assembly point?",
                "config": {"number_min": 0, "number_max": 200},
                "quiz": {"points": 1, "correct_min": 50, "correct_max": 60},
            },
            {
                "key": QC,
                "section_key": S2,
                "type": "single",
                "text": "Why not run?",
                "options": [{"key": C1, "label": "Others need warning"}, {"key": C2, "label": "?"}],
                "condition": {"src": QS, "op": "is", "val": B},
                "quiz": {"points": 1, "correct_options": [C1]},
            },
            {"key": QF, "section_key": S2, "type": "long", "text": "Anything else?"},
        ],
    }


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


async def sql(engine: AsyncEngine, query: str, **params: Any) -> list[Any]:
    async with engine.connect() as conn:
        return list((await conn.execute(text(query), params)).all())


async def seeded_training(
    client: AsyncClient, app: FastAPI, engine: AsyncEngine, hr: Headers
) -> str:
    created = (await client.post("/api/surveys", headers=hr, json={"kind": "training"})).json()
    survey_id: str = created["id"]
    saved = await client.put(
        f"/api/surveys/{survey_id}/draft",
        headers=hr,
        json={"draft": training_draft(), "draft_updated_at": created["draft_updated_at"]},
    )
    assert saved.status_code == 200, saved.text
    async with engine.begin() as conn:  # one person who never starts, so publishing can go
        await conn.execute(
            text(
                "INSERT INTO survey_audience (survey_id, employee_id, name, department, location)"
                " VALUES (:id, 'Z0001', 'Zara Never', 'Finance', 'Pune')"
            ),
            {"id": survey_id},
        )
    published = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    assert published.status_code == 200, published.text
    settings: Settings = app.state.settings
    async with app.state.sessionmaker() as session:
        made = await seed_training_results(session, settings, uuid.UUID(survey_id), PEOPLE)
    assert made["took"] > 300
    assert made["attempts"] > made["took"]  # some retook it
    return survey_id


def round1(value: Any) -> float | None:
    return None if value is None else round(float(value), 1)


async def expected_figures(engine: AsyncEngine, survey_id: str) -> dict[str, Any]:
    """The training figures, computed independently with plain SQL."""
    [(completed, passed, avg_attempts)] = await sql(
        engine,
        "SELECT count(*), count(*) FILTER (WHERE passed), avg(attempts) "
        "FROM survey_participation WHERE survey_id = :id AND attempts > 0",
        id=survey_id,
    )
    [(avg_score,)] = await sql(
        engine,
        "SELECT avg(r.score) FROM survey_participation p "
        "JOIN survey_responses r ON r.id = p.best_response_id WHERE p.survey_id = :id",
        id=survey_id,
    )
    buckets = dict(
        await sql(
            engine,
            "SELECT least(n, 5), count(*) FROM (SELECT employee_id, min(attempt_no) AS n "
            "FROM survey_responses WHERE survey_id = :id AND passed GROUP BY employee_id) x "
            "GROUP BY 1",
            id=survey_id,
        )
    )
    correct = {
        key: (shown, right)
        for key, shown, right in await sql(
            engine,
            """
            SELECT q.key::text,
                   (SELECT count(*) FROM response_shown s
                      JOIN survey_participation p ON p.best_response_id = s.response_id
                     WHERE s.question_id = q.id),
                   (SELECT count(*) FROM response_answers a
                      JOIN survey_participation p ON p.best_response_id = a.response_id
                     WHERE a.question_id = q.id AND a.correct)
            FROM survey_questions q JOIN surveys s ON s.current_version_id = q.version_id
            WHERE s.id = :id AND q.quiz IS NOT NULL
            """,
            id=survey_id,
        )
    }
    videos = dict(
        await sql(
            engine,
            "SELECT section_key::text, count(*) FROM video_views "
            "WHERE survey_id = :id AND completed_at IS NOT NULL GROUP BY 1",
            id=survey_id,
        )
    )
    return {
        "completed": completed,
        "passed": passed,
        "pass_rate": round(passed / completed, 4),
        "average_score": round1(avg_score),
        "average_attempts": round1(avg_attempts),
        "buckets": [buckets.get(n, 0) for n in range(1, 6)],
        "correct": correct,
        "videos": videos,
    }


async def expected_completion(engine: AsyncEngine, survey_id: str) -> dict[str, Any]:
    rows = await sql(
        engine,
        """
        SELECT a.employee_id,
               CASE WHEN p.attempts > 0 AND p.passed THEN 'passed'
                    WHEN p.attempts > 0 THEN 'not_passed'
                    WHEN p.employee_id IS NOT NULL
                      OR EXISTS (SELECT 1 FROM video_views v WHERE v.survey_id = a.survey_id
                                   AND v.employee_id = a.employee_id) THEN 'in_progress'
                    ELSE 'not_started' END AS status,
               p.best_score, coalesce(p.attempts, 0) AS attempts, p.passed_at,
               CASE WHEN p.passed_at IS NOT NULL
                    THEN (p.passed_at AT TIME ZONE 'Asia/Kolkata')::date > :due
                    ELSE CURRENT_DATE > :due END AS late
        FROM survey_audience a
        LEFT JOIN survey_participation p
               ON p.survey_id = a.survey_id AND p.employee_id = a.employee_id
        WHERE a.survey_id = :id
        """,
        id=survey_id,
        due=DUE,
    )
    return {row.employee_id: row for row in rows}


async def test_every_figure_matches_hand_written_sql(
    client: AsyncClient, app: FastAPI, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await seeded_training(client, app, engine, hr)
    base = f"/api/surveys/{survey_id}/results"

    figures = (await client.get(f"{base}/training", headers=hr)).json()
    summary = (await client.get(f"{base}/summary", headers=hr)).json()
    expected = await expected_figures(engine, survey_id)

    assert figures["completed"] == expected["completed"]
    assert figures["invited"] == PEOPLE + 1
    assert figures["pass_mark"] == 70
    assert figures["passed"] == expected["passed"]
    assert figures["pass_rate"] == expected["pass_rate"]
    assert figures["average_score"] == expected["average_score"]
    assert figures["average_attempts"] == expected["average_attempts"]
    assert [b["people"] for b in figures["attempts_to_pass"]] == expected["buckets"]
    assert [b["label"] for b in figures["attempts_to_pass"]] == ["1", "2", "3", "4", "5 or more"]
    assert sum(expected["buckets"]) == expected["passed"]
    assert {q["key"]: (q["shown"], q["correct"]) for q in figures["questions"]} == expected[
        "correct"
    ]
    shares = [q["share"] for q in figures["questions"]]
    assert shares == sorted(shares)  # lowest first
    for q in figures["questions"]:
        assert q["needs_attention"] is (q["share"] * 100 < 60)
    assert {v["section_key"]: v["watched"] for v in figures["videos"]} == expected["videos"]
    assert figures["due_date"] == DUE.isoformat()
    # The usual figures count each person once: their best attempt.
    assert summary["kind"] == "training"
    assert summary["responses"] == expected["completed"]


async def test_the_completion_report_lists_everyone_in_the_audience(
    client: AsyncClient, app: FastAPI, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await seeded_training(client, app, engine, hr)
    base = f"/api/surveys/{survey_id}/results/completion"
    expected = await expected_completion(engine, survey_id)

    pages: list[dict[str, Any]] = []
    first = (await client.get(base, headers=hr)).json()
    for page in range(1, -(-first["matching"] // first["page_size"]) + 1):
        pages.extend((await client.get(f"{base}?page={page}", headers=hr)).json()["rows"])

    assert first["total"] == PEOPLE + 1 == len(expected) == len(pages)
    assert {row["employee_id"] for row in pages} == set(expected)
    for row in pages:
        want = expected[row["employee_id"]]
        assert row["status"] == want.status, row
        assert row["attempts"] == want.attempts
        assert row["best_score"] == want.best_score
        assert row["late"] is want.late, row
        if want.status == "passed":
            assert datetime.fromisoformat(row["completed_at"]) == want.passed_at
        else:
            assert row["completed_at"] is None
    statuses = [w.status for w in expected.values()]
    assert first["counts"] == {
        s: statuses.count(s)
        for s in ("passed", "not_passed", "completed", "in_progress", "not_started")
    }
    assert first["counts"]["not_started"] >= 1  # includes people who never opened it
    assert first["counts"]["in_progress"] >= 1
    assert first["late"] == sum(1 for w in expected.values() if w.late)

    not_passed = (await client.get(f"{base}?status=not_passed", headers=hr)).json()
    assert not_passed["matching"] == first["counts"]["not_passed"]
    assert {r["status"] for r in not_passed["rows"]} == {"not_passed"}

    [(department, people)] = await sql(
        engine,
        "SELECT department, count(*) FROM survey_audience WHERE survey_id = :id "
        "GROUP BY department ORDER BY count(*) DESC LIMIT 1",
        id=survey_id,
    )
    by_department = (await client.get(f"{base}?department={department}", headers=hr)).json()
    assert by_department["total"] == people


async def test_results_and_downloads_use_best_attempts_only(
    client: AsyncClient, app: FastAPI, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await seeded_training(client, app, engine, hr)
    base = f"/api/surveys/{survey_id}/results"
    [(completed, attempts)] = await sql(
        engine,
        "SELECT (SELECT count(*) FROM survey_participation WHERE survey_id = :id "
        "AND attempts > 0), (SELECT count(*) FROM survey_responses WHERE survey_id = :id)",
        id=survey_id,
    )
    [(shown_first,)] = await sql(
        engine,
        "SELECT count(*) FROM response_shown s "
        "JOIN survey_participation p ON p.best_response_id = s.response_id "
        "JOIN survey_questions q ON q.id = s.question_id WHERE q.key = :key",
        key=QS,
    )
    assert attempts > completed

    questions = (await client.get(f"{base}/questions", headers=hr)).json()
    listed = (await client.get(f"{base}/responses", headers=hr)).json()
    trainings = (await client.get("/api/surveys?kind=training", headers=hr)).json()
    export = await client.get(f"{base}/export.xlsx?kind=analytics", headers=hr)
    completion = await client.get(f"{base}/completion.xlsx?status=passed", headers=hr)

    first = next(q for s in questions["sections"] for q in s["questions"] if q["key"] == QS)
    assert first["shown"] == shown_first
    assert listed["total"] == completed
    [item] = [t for t in trainings if t["id"] == survey_id]
    assert item["response_count"] == completed
    assert item["passed_count"] is not None
    assert item["pass_rate"] == round(item["passed_count"] / completed, 4)
    assert item["due_date"] == DUE.isoformat()

    workbook = load_workbook(io.BytesIO(export.content))
    assert workbook.sheetnames[:2] == ["Summary", "Completion"]
    sheet = workbook["Completion"]
    assert sheet["A2"].value.startswith(f"{completed:,} completed")
    assert sheet.max_row - 5 == PEOPLE + 1  # everyone, under the headings on row 5
    assert workbook["Responses"].max_row - 5 == completed
    passed_book = load_workbook(io.BytesIO(completion.content))["Completion"]
    passed_rows = list(passed_book.iter_rows(min_row=6, values_only=True))
    assert passed_rows
    assert {r[4] for r in passed_rows} == {"Passed"}


async def test_training_figures_are_only_for_trainings(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    response = await client.get(f"/api/surveys/{survey['id']}/results/training", headers=hr)
    assert response.status_code in (404, 409)
