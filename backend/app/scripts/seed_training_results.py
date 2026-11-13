"""Generate realistic results for a published training (development only).

    uv run python -m app.scripts.seed_training_results <training id> [people]

Adds people to the audience (L4001, L4002, … in a few departments and locations). Some never
start, some watch a video or save answers and stop, and the rest take the quiz through the
real path: watch every video, submit, and retake while the training's rules allow (getting
better each time). Attempt times are then spread over the last two weeks, so the completed
dates and late flags vary.
"""

import asyncio
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthenticatedUser
from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.models import Survey, SurveyAudience, SurveyResponse
from app.scripts.seed_responses import DEPARTMENTS, LOCATIONS, random_answers
from app.services import respond
from app.services.results_cache import results_cache
from app.services.scoring import quiz_key
from app.services.version_content import VersionContent, load_version
from app.services.videos import record_progress

NOT_STARTED_SHARE = 0.08
IN_PROGRESS_SHARE = 0.07
RETAKE_CHANCE = 0.75
SKILL_GAIN = 0.15


def _weighted(rng: random.Random, items: tuple[tuple[str, int], ...]) -> str:
    return rng.choices([name for name, _ in items], weights=[w for _, w in items])[0]


def quiz_answers(rng: random.Random, version: VersionContent, skill: float) -> dict[str, Any]:
    """Random answers, with each marked question right with probability `skill`."""
    answers = random_answers(rng, version.content)
    for question in version.scorable():
        key = quiz_key(question)
        if key is None or rng.random() >= skill:
            continue
        if question["type"] == "number":
            answers[question["key"]] = key["correct_min"]
        elif question["type"] == "multi":
            answers[question["key"]] = list(key["correct_options"])
        else:
            answers[question["key"]] = key["correct_options"][0]
    return answers


async def _watch_all(
    session: AsyncSession, survey_id: uuid.UUID, employee_id: str, sections: list[str]
) -> None:
    for section_key in sections:
        await record_progress(
            session,
            survey_id=survey_id,
            employee_id=employee_id,
            section_key=uuid.UUID(section_key),
            furthest_seconds=300,
            completed=True,
        )


async def seed_training_results(
    session: AsyncSession,
    settings: Settings,
    survey_id: uuid.UUID,
    people: int = 450,
    *,
    seed: int = 11,
    days: int = 14,
) -> dict[str, int]:
    """Returns how many people were added, took the quiz, and attempts submitted."""
    rng = random.Random(seed)  # noqa: S311 - test data, not security
    survey = await session.get(Survey, survey_id)
    if survey is None or survey.current_version_id is None or survey.kind != "training":
        msg = "Pick a published training."
        raise ValueError(msg)
    version = await load_version(session, survey.current_version_id)
    videos = [s["key"] for s in version.content["sections"] if s.get("video")]
    existing = set(
        (
            await session.scalars(
                select(SurveyAudience.employee_id).where(SurveyAudience.survey_id == survey_id)
            )
        ).all()
    )
    rows: list[dict[str, Any]] = []
    number = 4001
    while len(rows) < people:
        employee_id = f"L{number}"
        number += 1
        if employee_id in existing:
            continue
        rows.append(
            {
                "survey_id": survey_id,
                "employee_id": employee_id,
                "name": f"Learner {employee_id[1:]}",
                "department": _weighted(rng, DEPARTMENTS),
                "location": _weighted(rng, LOCATIONS),
                "source": "upload",
            }
        )
    await session.execute(insert(SurveyAudience).values(rows).on_conflict_do_nothing())
    await session.commit()

    took = attempts = 0
    for row in rows:
        user = AuthenticatedUser(employee_id=row["employee_id"], name=row["name"], role="employee")
        roll = rng.random()
        if roll < NOT_STARTED_SHARE:
            continue
        if roll < NOT_STARTED_SHARE + IN_PROGRESS_SHARE:
            if videos and rng.random() < 0.5:  # noqa: PLR2004 - half watched a little
                await record_progress(
                    session,
                    survey_id=survey_id,
                    employee_id=user.employee_id,
                    section_key=uuid.UUID(videos[0]),
                    furthest_seconds=rng.randint(10, 120),
                    completed=False,
                )
            else:
                await respond.save_draft(session, settings, user, survey_id, {})
            continue
        await _watch_all(session, survey_id, user.employee_id, videos)
        skill = rng.uniform(0.35, 0.95)
        took += 1
        while True:
            result = await respond.submit(
                session, settings, user, survey_id, quiz_answers(rng, version, skill)
            )
            attempts += 1
            assert result.training is not None  # noqa: S101 - a training
            if result.training.attempts_left == 0 or rng.random() > RETAKE_CHANCE:
                break
            skill = min(1.0, skill + SKILL_GAIN)

    await _spread_times(session, survey_id, rng, days)
    return {"people": len(rows), "took": took, "attempts": attempts}


async def _spread_times(
    session: AsyncSession, survey_id: uuid.UUID, rng: random.Random, days: int
) -> None:
    """Each person's attempts start on a day in the last `days` days, an hour or so apart;
    the pass date follows the first passing attempt."""
    now = datetime.now(UTC)
    attempts = (
        await session.execute(
            select(SurveyResponse.id, SurveyResponse.employee_id, SurveyResponse.attempt_no)
            .where(SurveyResponse.survey_id == survey_id)
            .order_by(SurveyResponse.employee_id, SurveyResponse.attempt_no)
        )
    ).all()
    start: dict[str | None, datetime] = {}
    for response_id, employee_id, attempt_no in attempts:
        if employee_id not in start:
            start[employee_id] = now - timedelta(
                days=rng.randint(1, days - 1), hours=rng.randint(0, 10)
            )
        when = start[employee_id] + timedelta(hours=attempt_no - 1, minutes=rng.randint(0, 50))
        await session.execute(
            update(SurveyResponse)
            .where(SurveyResponse.id == response_id)
            .values(submitted_at=when, updated_at=when)
        )
    await session.execute(
        text(
            """
            UPDATE survey_participation p SET
              passed_at = (SELECT min(r.submitted_at) FROM survey_responses r
                           WHERE r.survey_id = p.survey_id AND r.employee_id = p.employee_id
                             AND r.passed),
              submitted_at = (SELECT max(r.submitted_at) FROM survey_responses r
                              WHERE r.survey_id = p.survey_id
                                AND r.employee_id = p.employee_id)
            WHERE p.survey_id = :id AND p.attempts > 0
            """
        ),
        {"id": survey_id},
    )
    await session.commit()
    results_cache.invalidate(survey_id)


async def main(survey_id: str, people: int) -> None:
    settings = get_settings()
    if settings.is_production:
        sys.stderr.write("Refusing to generate test results when APP_ENV=production.\n")
        raise SystemExit(1)
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            made = await seed_training_results(session, settings, uuid.UUID(survey_id), people)
    finally:
        await engine.dispose()
    sys.stdout.write(
        f"Added {made['people']} people; {made['took']} took the quiz "
        f"({made['attempts']} attempts).\n"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:  # noqa: PLR2004
        sys.stderr.write("Usage: python -m app.scripts.seed_training_results <id> [people]\n")
        raise SystemExit(2)
    asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 450))  # noqa: PLR2004
