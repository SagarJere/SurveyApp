"""Generate realistic test responses for a published survey (development only).

    uv run python -m app.scripts.seed_responses <survey id> [count]

Each response goes through the real submit path, so conditions, hidden questions and the
"shown" records behave exactly as for real people. Respondents are added to the audience
(T3001, T3002, … in a few departments and locations), plus some who never respond. Submission
times are then spread over the last two weeks so the daily chart has a shape.
"""

import asyncio
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthenticatedUser
from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.models import Survey, SurveyAudience, SurveyParticipation, SurveyResponse
from app.services import respond
from app.services.version_content import load_version

DEPARTMENTS = (("Engineering", 5), ("Sales", 3), ("Operations", 3), ("People", 1), ("Finance", 1))
LOCATIONS = (("Pune", 3), ("Mumbai", 2), ("Delhi", 2), ("Bengaluru", 2))
COMMENTS = (
    "More flexibility on office days would help.",
    "The VPN drops several times a day.",
    "Happy with the current setup, thanks.",
    "A second monitor would make a big difference.",
    "Meeting rooms are hard to book on Tuesdays.",
    "Please keep the hybrid policy.",
    "The canteen could open earlier.",
    "Better noise cancelling headsets for calls.",
)
NON_RESPONDER_SHARE = 0.15


def _weighted(rng: random.Random, items: tuple[tuple[str, int], ...]) -> str:
    return rng.choices([name for name, _ in items], weights=[w for _, w in items])[0]


def random_answers(rng: random.Random, content: dict[str, Any]) -> dict[str, Any]:
    """An answer for every question; the server drops the ones that end up hidden."""
    answers: dict[str, Any] = {}
    for q in content["questions"]:
        if not q["required"] and rng.random() < 0.2:  # noqa: PLR2004 - skip some optional ones
            continue
        kind = q["type"]
        keys = [o["key"] for o in q["options"]]
        if kind in ("single", "dropdown"):
            answers[q["key"]] = rng.choices(keys, weights=range(len(keys) + 1, 1, -1))[0]
        elif kind == "multi":
            chosen = [k for k in keys if rng.random() < 0.4]  # noqa: PLR2004
            answers[q["key"]] = chosen or [rng.choice(keys)]
        elif kind == "rating":
            answers[q["key"]] = rng.choices([1, 2, 3, 4, 5], weights=[1, 2, 4, 5, 3])[0]
        elif kind == "money":
            config = q["config"]
            low = float(config.get("min") or 0)
            high = float(config.get("max") or 300_000)
            value = min(high, max(low, rng.lognormvariate(10, 0.9)))
            answers[q["key"]] = round(value, 2) if config.get("decimals") else float(round(value))
        elif kind == "number":
            config = q["config"]
            low = config.get("number_min")
            high = config.get("number_max")
            low = float(low) if low is not None else 0.0
            high = float(high) if high is not None else max(low + 10, 10.0)
            value = rng.triangular(low, high, low + (high - low) / 3)
            answers[q["key"]] = round(value, 2) if config.get("number_decimals") else round(value)
        else:
            answers[q["key"]] = rng.choice(COMMENTS)
    return answers


async def seed_responses(
    session: AsyncSession,
    settings: Settings,
    survey_id: uuid.UUID,
    count: int,
    *,
    seed: int = 7,
    days: int = 14,
    first_department: tuple[str, int] | None = None,
) -> int:
    """Add `count` respondents and their responses. `first_department=("Legal", 3)` puts the
    first 3 respondents in their own small department (useful for small-group checks)."""
    rng = random.Random(seed)  # noqa: S311 - test data, not security
    survey = await session.get(Survey, survey_id)
    if survey is None or survey.current_version_id is None:
        msg = "The survey must be published first."
        raise ValueError(msg)
    version = await load_version(session, survey.current_version_id)
    existing = set(
        (
            await session.scalars(
                select(SurveyAudience.employee_id).where(SurveyAudience.survey_id == survey_id)
            )
        ).all()
    )
    total_people = count + round(count * NON_RESPONDER_SHARE)
    people: list[dict[str, Any]] = []
    number = 3001
    while len(people) < total_people:
        employee_id = f"T{number}"
        number += 1
        if employee_id in existing:
            continue
        index = len(people)
        department = (
            first_department[0]
            if first_department and index < first_department[1]
            else _weighted(rng, DEPARTMENTS)
        )
        people.append(
            {
                "survey_id": survey_id,
                "employee_id": employee_id,
                "name": f"Test person {employee_id[1:]}",
                "department": department,
                "location": _weighted(rng, LOCATIONS),
                "source": "upload",
            }
        )
    await session.execute(insert(SurveyAudience).values(people).on_conflict_do_nothing())
    await session.commit()

    submitted = 0
    for person in people[:count]:
        user = AuthenticatedUser(
            employee_id=person["employee_id"], name=person["name"], role="employee"
        )
        await respond.submit(
            session, settings, user, survey_id, random_answers(rng, version.content)
        )
        submitted += 1

    # Spread the submissions over the last `days` days, busier near the start.
    now = datetime.now(UTC)
    respondents = [p["employee_id"] for p in people[:count]]
    anonymous = bool(version.content["settings"].get("anonymous"))
    response_ids = list(
        (
            await session.scalars(
                select(SurveyResponse.id)
                .where(SurveyResponse.survey_id == survey_id)
                .order_by(SurveyResponse.id)
            )
        ).all()
    )
    for response_id in response_ids:
        when = now - timedelta(
            days=min(days - 1, int(rng.expovariate(0.35))), hours=rng.randint(0, 12)
        )
        if anonymous:
            when = when.replace(minute=0, second=0, microsecond=0)
        await session.execute(
            update(SurveyResponse).where(SurveyResponse.id == response_id).values(submitted_at=when)
        )
    for employee_id in respondents:
        when = now - timedelta(days=rng.randint(0, days - 1))
        await session.execute(
            update(SurveyParticipation)
            .where(
                SurveyParticipation.survey_id == survey_id,
                SurveyParticipation.employee_id == employee_id,
            )
            .values(
                submitted_at=when.replace(minute=0, second=0, microsecond=0) if anonymous else when
            )
        )
    await session.commit()
    return submitted


async def main(survey_id: str, count: int) -> None:
    settings = get_settings()
    if settings.is_production:
        sys.stderr.write("Refusing to generate test responses when APP_ENV=production.\n")
        raise SystemExit(1)
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            made = await seed_responses(session, settings, uuid.UUID(survey_id), count)
    finally:
        await engine.dispose()
    sys.stdout.write(f"Added {made} responses.\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:  # noqa: PLR2004
        sys.stderr.write("Usage: python -m app.scripts.seed_responses <survey id> [count]\n")
        raise SystemExit(2)
    asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 420))  # noqa: PLR2004
