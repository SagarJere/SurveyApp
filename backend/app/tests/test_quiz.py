"""Phase T2: answer keys, server-side scoring, retakes, the answer review and the best attempt."""

import json
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.tests.conftest import bearer

Headers = dict[str, str]

S1 = str(uuid.uuid4())
QS, QM, QN, QC, QF = (str(uuid.uuid4()) for _ in range(5))
A, B, M1, M2, M3, C1, C2 = (str(uuid.uuid4()) for _ in range(7))

ALL_RIGHT = {QS: A, QM: [M1, M3], QN: 4}  # 4 of 4 points; QC stays hidden
ALL_WRONG = {QS: B, QM: [M2], QN: 9, QC: C2}  # 0 of 5 points
SIXTY = {QS: B, QM: [M1, M3], QN: 3, QC: C1}  # 3 of 5 points


def today() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def quiz_draft(**quiz: Any) -> dict[str, Any]:
    """Single (2 points), checkboxes, Number 3 to 5, a follow-up shown only after a wrong first
    answer, and an unmarked feedback question."""
    return {
        "title": "Fire safety basics",
        "description": "",
        "settings": {
            "layout": "all",
            "opens_at": (today() - timedelta(days=1)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
            "quiz": {"pass_mark": 80, "retakes": "limit", "max_attempts": 3, **quiz},
        },
        "sections": [{"key": S1, "title": "Quiz", "description": "", "condition": None}],
        "questions": [
            {
                "key": QS,
                "section_key": S1,
                "type": "single",
                "text": "What should you do first?",
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
                "section_key": S1,
                "type": "number",
                "text": "How many metres away should you stand?",
                "config": {"number_min": 0, "number_max": 10, "number_unit": "m"},
                "quiz": {"points": 1, "correct_min": 3, "correct_max": 5},
            },
            {
                "key": QC,
                "section_key": S1,
                "type": "single",
                "text": "Then what?",
                "options": [{"key": C1, "label": "Call 101"}, {"key": C2, "label": "Wait"}],
                "condition": {"src": QS, "op": "is", "val": B},
                "quiz": {"points": 1, "correct_options": [C1]},
            },
            {"key": QF, "section_key": S1, "type": "long", "text": "Any feedback?"},
        ],
    }


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def person(token_for: Callable[..., str]) -> Callable[[str], Headers]:
    return lambda employee_id: bearer(token_for(employee_id, "employee", f"Person {employee_id}"))


async def save(client: AsyncClient, hr: Headers, survey_id: str, draft: dict[str, Any]) -> Any:
    current = (await client.get(f"/api/surveys/{survey_id}", headers=hr)).json()
    return await client.put(
        f"/api/surveys/{survey_id}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": current["draft_updated_at"]},
    )


async def training(client: AsyncClient, hr: Headers, draft: dict[str, Any]) -> str:
    survey_id: str = (
        await client.post("/api/surveys", headers=hr, json={"kind": "training"})
    ).json()["id"]
    saved = await save(client, hr, survey_id, draft)
    assert saved.status_code == 200, saved.text
    await client.put(
        f"/api/surveys/{survey_id}/audience/open-to-all", headers=hr, json={"open_to_all": True}
    )
    return survey_id


async def published(client: AsyncClient, hr: Headers, **quiz: Any) -> str:
    survey_id = await training(client, hr, quiz_draft(**quiz))
    response = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    assert response.status_code == 200, response.text
    return survey_id


async def submit(client: AsyncClient, who: Headers, survey_id: str, answers: dict[str, Any]) -> Any:
    return await client.post(
        f"/api/respond/{survey_id}/submit", headers=who, json={"answers": answers}
    )


async def attempt(
    client: AsyncClient, who: Headers, survey_id: str, answers: dict[str, Any]
) -> dict[str, Any]:
    response = await submit(client, who, survey_id, answers)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()["training"]
    return result


# --- builder and publish ----------------------------------------------------------------------


async def test_a_new_training_starts_with_default_quiz_settings(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    created = (await client.post("/api/surveys", headers=hr, json={"kind": "training"})).json()
    survey = (await client.post("/api/surveys", headers=hr)).json()

    assert created["draft"]["settings"]["quiz"] == {
        "pass_mark": 80,
        "show_pass_mark": True,
        "show_score": True,
        "show_answers": "after_pass_or_last",
        "retakes": "limit",
        "max_attempts": 3,
    }
    assert survey["draft"]["settings"]["quiz"] is None


async def test_only_trainings_have_correct_answers(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    saved = await save(client, hr, survey["id"], quiz_draft())

    assert saved.status_code == 422
    assert saved.json()["error"]["message"] == "Only trainings can have correct answers."


async def test_publish_needs_complete_answer_keys_and_a_retake_rule_that_can_end(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    draft = quiz_draft(retakes="until_pass", pass_mark=None)
    draft["questions"][0]["quiz"]["correct_options"] = []
    draft["questions"][1]["quiz"]["correct_options"] = [str(uuid.uuid4())]  # not an option
    draft["questions"][2]["quiz"] = {"points": 1, "correct_min": 6, "correct_max": 4}
    draft["questions"][3]["quiz"]["correct_options"] = [C1, C2]
    survey_id = await training(client, hr, draft)

    checked = (await client.post(f"/api/surveys/{survey_id}/validate", headers=hr)).json()
    refused = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)

    assert [(i["code"], i["question_key"], i["message"]) for i in checked["issues"]] == [
        ("quiz_key_missing", QS, "Q1: tick its correct answer, or turn marking off."),
        ("quiz_key_missing", QM, "Q2: tick its correct answer, or turn marking off."),
        ("quiz_key_missing", QN, "Q3: the lowest correct answer is above the highest."),
        ("quiz_key_missing", QC, "Q4: tick only one correct answer."),
        (
            "quiz_settings",
            None,
            'Set a pass mark, or choose another retake rule than "until they pass".',
        ),
    ]
    assert refused.status_code == 422


async def test_number_answers_must_be_possible(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    draft = quiz_draft()
    draft["questions"][2]["quiz"] = {"points": 1, "correct_min": 8, "correct_max": 12}
    survey_id = await training(client, hr, draft)

    checked = (await client.post(f"/api/surveys/{survey_id}/validate", headers=hr)).json()

    assert [i["message"] for i in checked["issues"]] == [
        "Q3: its correct answer is outside the numbers people can enter."
    ]


async def test_a_training_without_marked_questions_gets_a_warning(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    draft = quiz_draft()
    for question in draft["questions"]:
        question.pop("quiz", None)
    survey_id = await training(client, hr, draft)

    checked = (await client.post(f"/api/surveys/{survey_id}/validate", headers=hr)).json()

    assert checked["issues"] == []
    assert [w["code"] for w in checked["warnings"]] == ["quiz_unmarked"]


async def test_publish_stores_the_answer_keys_on_the_version(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    draft = quiz_draft()
    draft["questions"][1]["type"] = "rating"  # changed type: its old key isn't published
    survey_id = await training(client, hr, draft)
    assert (await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)).status_code == 200

    async with engine.connect() as connection:
        rows = (
            await connection.execute(
                text(
                    "SELECT q.key::text, q.quiz FROM survey_questions q "
                    "JOIN surveys s ON s.current_version_id = q.version_id "
                    "WHERE s.id = :id ORDER BY q.sort_order"
                ),
                {"id": survey_id},
            )
        ).all()

    assert dict(rows) == {
        QS: {"points": 2, "correct_options": [A]},
        QM: None,
        QN: {"points": 1, "correct_min": 3, "correct_max": 5},
        QC: {"points": 1, "correct_options": [C1]},
        QF: None,
    }


# --- what respondents receive -----------------------------------------------------------------


async def test_the_answer_key_never_reaches_the_respondent(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, show_answers="after_pass_or_last")
    who = person("W1")

    before = await client.get(f"/api/respond/{survey_id}", headers=who)
    failed = await submit(client, who, survey_id, ALL_WRONG)
    after = await client.get(f"/api/respond/{survey_id}", headers=who)

    for response in (before, failed, after):
        assert response.status_code == 200, response.text
        body = json.dumps(response.json())
        assert "correct_options" not in body
        assert "correct_min" not in body
        assert "correct_answer" not in body
    payload = before.json()
    assert "quiz" not in payload["settings"]
    assert all("quiz" not in q for q in payload["questions"])
    assert payload["training"] == {
        "pass_mark": 80,
        "retakes": "limit",
        "max_attempts": 3,
        "attempts_used": 0,
        "attempts_left": 3,
        "last_result": None,
    }


async def test_the_pass_mark_is_hidden_up_front_when_the_creator_says_so(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, show_pass_mark=False)
    payload = (await client.get(f"/api/respond/{survey_id}", headers=person("W1"))).json()
    assert payload["training"]["pass_mark"] is None


# --- scoring --------------------------------------------------------------------------------------


async def test_the_server_scores_each_attempt(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr)
    who = person("W1")

    result = await attempt(client, who, survey_id, {**SIXTY, QF: "Clear video"})

    assert result == {
        "attempt_no": 1,
        "score": 60,
        "points": 3,
        "max_points": 5,  # the follow-up was shown, so it counts
        "passed": False,
        "pass_mark": 80,
        "attempts_used": 1,
        "attempts_left": 2,
        "review": None,
    }
    async with engine.connect() as connection:
        response = (
            await connection.execute(
                text(
                    "SELECT attempt_no, points, max_points, score, passed FROM survey_responses "
                    "WHERE survey_id = :id"
                ),
                {"id": survey_id},
            )
        ).one()
        correct: dict[str, bool | None] = dict(
            (
                await connection.execute(
                    text(
                        "SELECT DISTINCT ON (q.key) q.key::text, a.correct FROM response_answers a "
                        "JOIN survey_questions q ON q.id = a.question_id ORDER BY q.key, a.id"
                    )
                )
            ).all()
        )
        rows_per_answer = (
            await connection.execute(
                text(
                    "SELECT count(*) FILTER (WHERE correct IS NOT NULL) FROM response_answers a "
                    "JOIN survey_questions q ON q.id = a.question_id WHERE q.key = :key"
                ),
                {"key": QM},
            )
        ).scalar_one()
    assert tuple(response) == (1, 3, 5, 60, False)
    assert correct == {QS: False, QM: True, QN: True, QC: True, QF: None}
    assert rows_per_answer == 1  # two boxes ticked, marked once


async def test_hidden_questions_dont_count(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr)
    # QC's answer is dropped: it's hidden when the first answer is right.
    result = await attempt(client, person("W1"), survey_id, {**ALL_RIGHT, QC: C2})
    assert (result["points"], result["max_points"], result["score"]) == (4, 4, 100)
    assert result["passed"] is True


async def test_the_score_can_be_hidden(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, show_score=False)
    result = await attempt(client, person("W1"), survey_id, SIXTY)
    assert result["score"] is None
    assert result["passed"] is None
    assert result["pass_mark"] is None
    assert result["attempts_left"] == 2


# --- retakes --------------------------------------------------------------------------------------


async def test_no_retakes_means_one_attempt(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, retakes="none")
    who = person("W1")

    first = await attempt(client, who, survey_id, ALL_WRONG)
    again = await submit(client, who, survey_id, ALL_RIGHT)
    draft = await client.put(
        f"/api/respond/{survey_id}/draft", headers=who, json={"answers": {QS: A}}
    )

    assert first["attempts_left"] == 0
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "NO_ATTEMPTS_LEFT"
    assert draft.status_code == 409


async def test_up_to_n_attempts_and_passing_ends_them(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, retakes="limit", max_attempts=3)
    used_up, passer = person("W1"), person("W2")

    lefts = [
        (await attempt(client, used_up, survey_id, ALL_WRONG))["attempts_left"] for _ in range(3)
    ]
    fourth = await submit(client, used_up, survey_id, ALL_RIGHT)
    first = await attempt(client, passer, survey_id, ALL_RIGHT)
    second = await submit(client, passer, survey_id, ALL_RIGHT)

    assert lefts == [2, 1, 0]
    assert fourth.status_code == 409
    assert first["passed"] is True
    assert first["attempts_left"] == 0
    assert second.status_code == 409


async def test_until_they_pass(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, retakes="until_pass")
    who = person("W1")

    tries = [await attempt(client, who, survey_id, ALL_WRONG) for _ in range(5)]
    passing = await attempt(client, who, survey_id, ALL_RIGHT)
    extra = await submit(client, who, survey_id, ALL_RIGHT)

    assert [t["attempts_left"] for t in tries] == [None] * 5
    assert passing["attempt_no"] == 6
    assert passing["attempts_left"] == 0
    assert extra.status_code == 409


async def test_until_every_answer_is_correct(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    draft = quiz_draft(retakes="until_perfect", pass_mark=50)
    survey_id = await training(client, hr, draft)
    assert (await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)).status_code == 200
    who = person("W1")

    passed_not_perfect = await attempt(client, who, survey_id, SIXTY)
    perfect = await attempt(client, who, survey_id, ALL_RIGHT)
    extra = await submit(client, who, survey_id, ALL_RIGHT)

    assert passed_not_perfect["passed"] is True
    assert passed_not_perfect["attempts_left"] is None
    assert perfect["attempts_left"] == 0
    assert extra.status_code == 409


# --- the answer review ------------------------------------------------------------------------


async def test_answers_show_once_passed_or_out_of_attempts(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, retakes="limit", max_attempts=2)
    who = person("W1")

    first = await attempt(client, who, survey_id, ALL_WRONG)
    last = await attempt(client, who, survey_id, SIXTY)
    reloaded = (await client.get(f"/api/respond/{survey_id}", headers=who)).json()

    assert first["review"] is None
    assert last["review"] == [
        {
            "question_key": QS,
            "text": "What should you do first?",
            "correct": False,
            "points": 2,
            "your_answer": "Run",
            "correct_answer": "Raise the alarm",
        },
        {
            "question_key": QM,
            "text": "Which are fire classes?",
            "correct": True,
            "points": 1,
            "your_answer": "Class A, Class B",
            "correct_answer": "Class A, Class B",
        },
        {
            "question_key": QN,
            "text": "How many metres away should you stand?",
            "correct": True,
            "points": 1,
            "your_answer": "3 m",
            "correct_answer": "3 to 5 m",
        },
        {
            "question_key": QC,
            "text": "Then what?",
            "correct": True,
            "points": 1,
            "your_answer": "Call 101",
            "correct_answer": "Call 101",
        },
    ]
    assert reloaded["participation"]["status"] == "submitted"
    assert reloaded["training"]["last_result"] == last


@pytest.mark.parametrize(("rule", "shown"), [("always", True), ("never", False)])
async def test_the_creator_can_always_or_never_show_answers(
    client: AsyncClient,
    engine: AsyncEngine,
    hr: Headers,
    person: Callable[[str], Headers],
    rule: str,
    shown: bool,
) -> None:
    survey_id = await published(client, hr, show_answers=rule, retakes="limit", max_attempts=2)
    who = person("W1")
    first = await attempt(client, who, survey_id, ALL_WRONG)
    last = await attempt(client, who, survey_id, ALL_RIGHT)
    assert (first["review"] is not None) is shown
    assert (last["review"] is not None) is shown


# --- the best attempt counts ------------------------------------------------------------------


async def test_the_best_attempt_counts_and_every_attempt_is_kept(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr, retakes="until_perfect", pass_mark=50)
    who = person("W1")

    await attempt(client, who, survey_id, SIXTY)  # 60, passes
    await attempt(client, who, survey_id, ALL_WRONG)  # 0: doesn't undo the pass
    await attempt(client, who, survey_id, SIXTY)  # 60 again: the earlier one stays best

    async with engine.connect() as connection:
        attempts = (
            await connection.execute(
                text(
                    "SELECT id, attempt_no, score FROM survey_responses WHERE survey_id = :id "
                    "ORDER BY attempt_no"
                ),
                {"id": survey_id},
            )
        ).all()
        participation = (
            await connection.execute(
                text(
                    "SELECT attempts, best_response_id, best_score, passed, passed_at, "
                    "response_id FROM survey_participation WHERE survey_id = :id"
                ),
                {"id": survey_id},
            )
        ).one()
    assert [(a.attempt_no, a.score) for a in attempts] == [(1, 60), (2, 0), (3, 60)]
    assert participation.attempts == 3
    assert participation.best_response_id == attempts[0].id
    assert participation.best_score == 60
    assert participation.passed is True
    assert participation.passed_at is not None
    assert participation.response_id == attempts[2].id  # the latest attempt


async def test_a_retake_in_progress_resumes_as_a_draft(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr)
    who = person("W1")
    await attempt(client, who, survey_id, ALL_WRONG)

    done = (await client.get(f"/api/respond/{survey_id}", headers=who)).json()
    saved = await client.put(
        f"/api/respond/{survey_id}/draft", headers=who, json={"answers": {QS: A}}
    )
    retaking = (await client.get(f"/api/respond/{survey_id}", headers=who)).json()

    assert done["participation"]["status"] == "submitted"
    assert done["participation"]["can_respond_again"] is True
    assert saved.status_code == 200
    assert retaking["participation"]["status"] == "in_progress"
    assert retaking["participation"]["answers"] == {QS: A}
    assert retaking["training"]["last_result"]["score"] == 0


async def test_my_trainings_shows_the_best_result_and_attempts_left(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id = await published(client, hr)
    who = person("W1")
    await attempt(client, who, survey_id, SIXTY)

    [item] = (await client.get("/api/me/trainings", headers=who)).json()
    [fresh] = (await client.get("/api/me/trainings", headers=person("W2"))).json()

    assert item["id"] == survey_id
    assert (item["status"], item["best_score"], item["passed"]) == ("submitted", 60, False)
    assert (item["attempts_used"], item["attempts_left"]) == (1, 2)
    assert (fresh["attempts_used"], fresh["attempts_left"], fresh["best_score"]) == (0, 3, None)


async def test_repeat_survey_responses_are_numbered(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    """Surveys that allow responding again keep a row per response, numbered per person."""
    draft = quiz_draft()
    draft["settings"] = {**draft["settings"], "one_response": False}
    del draft["settings"]["quiz"]
    for question in draft["questions"]:
        question.pop("quiz", None)
    survey_id = (await client.post("/api/surveys", headers=hr)).json()["id"]
    assert (await save(client, hr, survey_id, draft)).status_code == 200
    await client.put(
        f"/api/surveys/{survey_id}/audience/open-to-all", headers=hr, json={"open_to_all": True}
    )
    assert (await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)).status_code == 200
    who = person("W1")

    for _ in range(2):
        response = await submit(client, who, survey_id, ALL_RIGHT)
        assert response.status_code == 200, response.text
        assert response.json()["training"] is None

    async with engine.connect() as connection:
        numbers = (
            await connection.execute(
                text(
                    "SELECT attempt_no, score FROM survey_responses WHERE survey_id = :id "
                    "ORDER BY attempt_no"
                ),
                {"id": survey_id},
            )
        ).all()
    assert [tuple(n) for n in numbers] == [(1, None), (2, None)]
