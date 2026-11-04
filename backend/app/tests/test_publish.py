import copy
import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.models import QuestionOption, SurveyVersion, VersionQuestion, VersionSection
from app.tests.conftest import bearer

PULSE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/workplace-pulse.json").read_text()
)["draft"]

Headers = dict[str, str]


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def other_hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1003", "hr"))


async def _survey(
    client: AsyncClient, hr: Headers, draft: dict[str, Any] = PULSE
) -> dict[str, Any]:
    survey: dict[str, Any] = (await client.post("/api/surveys", headers=hr)).json()
    saved = await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )
    assert saved.status_code == 200, saved.text
    survey["draft_updated_at"] = saved.json()["draft_updated_at"]
    opened = await client.put(
        f"/api/surveys/{survey['id']}/audience/open-to-all", headers=hr, json={"open_to_all": True}
    )
    assert opened.status_code == 200
    return survey


async def _publish(client: AsyncClient, hr: Headers, survey: dict[str, Any]) -> Any:
    return await client.post(f"/api/surveys/{survey['id']}/publish", headers=hr)


async def _edit(
    client: AsyncClient, hr: Headers, survey: dict[str, Any], draft: dict[str, Any]
) -> None:
    current = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    saved = await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": current["draft_updated_at"]},
    )
    assert saved.status_code == 200, saved.text


async def _version_rows(engine: AsyncEngine, survey_id: str, version_no: int) -> dict[str, Any]:
    async with engine.connect() as conn:
        version = (
            await conn.execute(
                select(SurveyVersion).where(
                    SurveyVersion.survey_id == uuid.UUID(survey_id),
                    SurveyVersion.version_no == version_no,
                )
            )
        ).one()
        sections = (
            await conn.execute(
                select(VersionSection)
                .where(VersionSection.version_id == version.id)
                .order_by(VersionSection.sort_order)
            )
        ).all()
        questions = (
            await conn.execute(
                select(VersionQuestion)
                .where(VersionQuestion.version_id == version.id)
                .order_by(VersionQuestion.sort_order)
            )
        ).all()
        options = (
            await conn.execute(
                select(
                    QuestionOption.key,
                    QuestionOption.label,
                    VersionQuestion.key.label("question_key"),
                )
                .join(VersionQuestion, VersionQuestion.id == QuestionOption.question_id)
                .where(VersionQuestion.version_id == version.id)
                .order_by(VersionQuestion.sort_order, QuestionOption.sort_order)
            )
        ).all()
    return {"version": version, "sections": sections, "questions": questions, "options": options}


async def test_publish_creates_version_1_with_all_content(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _survey(client, hr)

    response = await _publish(client, hr, survey)

    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 1
    assert response.json()["status"] == "published"
    rows = await _version_rows(engine, survey["id"], 1)
    assert rows["version"].title == PULSE["title"]
    assert rows["version"].settings == PULSE["settings"]
    assert rows["version"].theme == PULSE["theme"]
    assert [str(s.key) for s in rows["sections"]] == [s["key"] for s in PULSE["sections"]]
    assert rows["sections"][1].condition == PULSE["sections"][1]["condition"]
    assert [str(q.key) for q in rows["questions"]] == [q["key"] for q in PULSE["questions"]]
    assert [q.sort_order for q in rows["questions"]] == list(range(9))
    money = rows["questions"][4]
    assert money.config == {"currency": "INR", "min": None, "max": 500000.0, "decimals": False}
    assert rows["questions"][0].config == {}
    expected_options = [
        (q["key"], o["key"], o["label"])
        for q in PULSE["questions"]
        if q["type"] in ("single", "multi", "dropdown")
        for o in q["options"]
    ]
    assert [(str(o.question_key), str(o.key), o.label) for o in rows["options"]] == expected_options

    detail = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert detail["status"] == "published"
    assert detail["version_no"] == 1
    assert detail["has_unpublished_changes"] is False


async def test_republishing_creates_version_2_with_the_same_keys(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _survey(client, hr)
    await _publish(client, hr, survey)
    edited = copy.deepcopy(PULSE)
    edited["questions"][0]["text"] = "How happy are you with your work setup?"
    edited["questions"][1]["options"][1]["label"] = "Hybrid, 2 to 3 days"
    await _edit(client, hr, survey, edited)

    detail = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert detail["has_unpublished_changes"] is True
    response = await _publish(client, hr, survey)

    assert response.status_code == 200
    assert response.json()["version_no"] == 2
    v1 = await _version_rows(engine, survey["id"], 1)
    v2 = await _version_rows(engine, survey["id"], 2)
    assert [q.key for q in v2["questions"]] == [q.key for q in v1["questions"]]
    assert [o.key for o in v2["options"]] == [o.key for o in v1["options"]]
    assert v1["questions"][0].text == PULSE["questions"][0]["text"]  # v1 untouched
    assert v2["questions"][0].text == "How happy are you with your work setup?"
    listed = (await client.get("/api/surveys", headers=hr)).json()[0]
    assert listed["version_no"] == 2
    assert listed["has_unpublished_changes"] is False


async def test_publishing_without_changes_is_refused(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _survey(client, hr)
    await _publish(client, hr, survey)

    response = await _publish(client, hr, survey)

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "There are no changes to publish."


async def test_invalid_drafts_are_not_published(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    draft = copy.deepcopy(PULSE)
    draft["questions"][3]["options"] = draft["questions"][3]["options"][:1]
    draft["questions"][0]["text"] = ""
    survey = await _survey(client, hr, draft)

    response = await _publish(client, hr, survey)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["message"] == "Fix 2 issues before publishing. Q1 has no question text."
    assert [i["code"] for i in error["details"]["issues"]] == [
        "question_text_missing",
        "options_too_few",
    ]
    async with engine.connect() as conn:
        count = await conn.scalar(text("SELECT count(*) FROM survey_versions"))
    assert count == 0
    detail = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert detail["status"] == "draft"


async def test_missing_theme_images_block_publishing(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    draft = copy.deepcopy(PULSE)
    draft["theme"]["cover"] = str(uuid.uuid4())
    draft["theme"]["background"] = None
    survey = await _survey(client, hr, draft)

    issues = (await client.post(f"/api/surveys/{survey['id']}/validate", headers=hr)).json()[
        "issues"
    ]

    assert [i["message"] for i in issues] == [
        "The cover image is no longer available. Choose another.",
        "The page background image is no longer available. Choose another.",
    ]
    assert (await _publish(client, hr, survey)).status_code == 422


async def test_accent_only_cover_and_no_background_are_fine(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    draft = copy.deepcopy(PULSE)
    draft["theme"].update(cover=None, background_style="none", background=None)
    survey = await _survey(client, hr, draft)

    assert (await _publish(client, hr, survey)).status_code == 200


async def test_close_lifecycle(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey = await _survey(client, hr)
    close_url = f"/api/surveys/{survey['id']}/close"

    draft_close = await client.post(close_url, headers=hr)
    await _publish(client, hr, survey)
    closed = await client.post(close_url, headers=hr)
    again = await client.post(close_url, headers=hr)
    await _edit(client, hr, survey, {**PULSE, "title": "After closing"})
    republish = await _publish(client, hr, survey)

    assert draft_close.status_code == 409
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"
    assert closed.json()["closed_at"]
    assert again.status_code == 409
    assert republish.status_code == 409
    assert republish.json()["error"]["message"] == (
        "This survey is closed, so it can't be published again."
    )
    detail = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    assert detail["status"] == "closed"
    assert detail["closed_at"]


async def test_only_editors_can_publish_and_close(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, other_hr: Headers, gallery: list[str]
) -> None:
    survey = await _survey(client, hr)

    assert (await _publish(client, other_hr, survey)).status_code == 404
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO survey_members VALUES (:id, 'E1003', 'viewer')"), {"id": survey["id"]}
        )
    assert (await _publish(client, other_hr, survey)).status_code == 403
    assert (
        await client.post(f"/api/surveys/{survey['id']}/close", headers=other_hr)
    ).status_code == 403
