"""Training results (docs/09-trainings.md, "Reports"; docs/07-reports-dashboard.md).

Every figure uses each person's best attempt (services.results.filtered_responses). The
completion report lists everyone in the audience, including people who haven't started.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal

from sqlalchemy import Select, and_, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ResponseAnswer,
    ResponseShown,
    SurveyAudience,
    SurveyParticipation,
    SurveyResponse,
    VersionQuestion,
    VideoView,
)
from app.services.respond import today
from app.services.results import Scope, filtered_responses
from app.services.scoring import quiz_key

CompletionStatus = Literal["passed", "not_passed", "completed", "in_progress", "not_started"]
STATUSES: tuple[CompletionStatus, ...] = (
    "passed",
    "not_passed",
    "completed",
    "in_progress",
    "not_started",
)
STATUS_LABELS: dict[str, str] = {
    "passed": "Passed",
    "not_passed": "Not passed",
    "completed": "Completed",
    "in_progress": "In progress",
    "not_started": "Not started",
}
# % correct below this needs attention (docs/09-trainings.md).
NEEDS_ATTENTION = 60
# "Attempts needed to pass": one bar per count up to this, then "this many or more".
ATTEMPT_BUCKETS = 5
COMPLETION_PAGE = 50


def quiz_rules(scope: Scope) -> dict[str, Any]:
    rules: dict[str, Any] = scope.version.content["settings"].get("quiz") or {}
    return rules


def due_date(scope: Scope) -> date | None:
    value = scope.version.content["settings"].get("due_date")
    return date.fromisoformat(value) if isinstance(value, str) and value else None


def _people_filter(scope: Scope, department: Any, location: Any) -> list[Any]:
    """Department and location filters on a person's own columns."""
    f = scope.filters
    conditions: list[Any] = []
    if f.department is not None:
        conditions.append(
            department.is_(None) if f.department == "" else department == f.department
        )
    if f.location is not None:
        conditions.append(location.is_(None) if f.location == "" else location == f.location)
    return conditions


# --- figures ------------------------------------------------------------------------------------


async def _percent_correct(session: AsyncSession, scope: Scope, ids: Any) -> list[dict[str, Any]]:
    """Marked questions of the reported version: of the people shown it, how many got it
    right. Lowest first, so the questions people struggle with are on top."""
    marked = [
        (number, q)
        for number, q in enumerate(scope.version.scorable(), start=1)
        if quiz_key(q) is not None
    ]
    if not marked:
        return []
    keys = [uuid.UUID(q["key"]) for _, q in marked]
    shown = dict(
        (
            await session.execute(
                select(VersionQuestion.key, func.count())
                .select_from(ResponseShown)
                .join(VersionQuestion, VersionQuestion.id == ResponseShown.question_id)
                .where(
                    ResponseShown.response_id.in_(select(ids.c.id)), VersionQuestion.key.in_(keys)
                )
                .group_by(VersionQuestion.key)
            )
        ).all()
    )
    correct = dict(
        (
            await session.execute(
                select(VersionQuestion.key, func.count())
                .select_from(ResponseAnswer)
                .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
                .where(
                    ResponseAnswer.response_id.in_(select(ids.c.id)),
                    VersionQuestion.key.in_(keys),
                    ResponseAnswer.correct.is_(True),
                )
                .group_by(VersionQuestion.key)
            )
        ).all()
    )
    items: list[dict[str, Any]] = []
    for number, q in marked:
        key = uuid.UUID(q["key"])
        n_shown = shown.get(key, 0)
        n_correct = correct.get(key, 0)
        share = round(n_correct / n_shown, 4) if n_shown else None
        items.append(
            {
                "key": q["key"],
                "number": number,
                "text": q["text"],
                "shown": n_shown,
                "correct": n_correct,
                "share": share,
                "needs_attention": share is not None and share * 100 < NEEDS_ATTENTION,
            }
        )
    items.sort(key=lambda i: (i["share"] is None, i["share"] or 0, i["number"]))
    return items


async def _attempts_to_pass(session: AsyncSession, scope: Scope, ids: Any) -> list[dict[str, Any]]:
    """How many attempts people needed to pass: 1, 2, … and "5 or more"."""
    first_pass = (
        select(func.min(SurveyResponse.attempt_no).label("n"))
        .where(
            SurveyResponse.survey_id == scope.survey.id,
            SurveyResponse.passed.is_(True),
            SurveyResponse.employee_id.in_(
                select(SurveyResponse.employee_id).where(SurveyResponse.id.in_(select(ids.c.id)))
            ),
        )
        .group_by(SurveyResponse.employee_id)
        .subquery()
    )
    bucket = func.least(first_pass.c.n, ATTEMPT_BUCKETS)
    result = await session.execute(select(bucket, func.count()).group_by(bucket))
    counts: dict[int, int] = {int(n): int(people) for n, people in result.all()}
    return [
        {
            "attempts": n,
            "label": f"{n} or more" if n == ATTEMPT_BUCKETS else str(n),
            "people": counts.get(n, 0),
        }
        for n in range(1, ATTEMPT_BUCKETS + 1)
    ]


async def _videos(session: AsyncSession, scope: Scope) -> list[dict[str, Any]]:
    """For each section video: how many people watched it to the end."""
    sections = [
        (number, s)
        for number, s in enumerate(scope.version.content["sections"], start=1)
        if s.get("video")
    ]
    if not sections:
        return []
    query = select(VideoView.section_key, func.count()).where(
        VideoView.survey_id == scope.survey.id, VideoView.completed_at.is_not(None)
    )
    people = _people_filter(scope, SurveyAudience.department, SurveyAudience.location)
    if people and not scope.survey.open_to_all:
        query = query.join(
            SurveyAudience,
            and_(
                SurveyAudience.survey_id == VideoView.survey_id,
                SurveyAudience.employee_id == VideoView.employee_id,
            ),
        ).where(*people)
    counts = dict((await session.execute(query.group_by(VideoView.section_key))).all())
    return [
        {
            "section_key": s["key"],
            "title": s["title"].strip() or f"Section {number}",
            "watched": counts.get(uuid.UUID(s["key"]), 0),
        }
        for number, s in sections
    ]


async def training_figures(session: AsyncSession, scope: Scope) -> dict[str, Any]:
    """Completed, passed, average score and attempts, attempts needed to pass, % correct per
    question, and videos watched to the end."""
    ids = filtered_responses(scope).subquery()
    row = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(SurveyParticipation.passed.is_(True)),
                func.avg(SurveyResponse.score),
                func.avg(SurveyParticipation.attempts),
            )
            .select_from(SurveyResponse)
            .join(
                SurveyParticipation,
                and_(
                    SurveyParticipation.survey_id == SurveyResponse.survey_id,
                    SurveyParticipation.best_response_id == SurveyResponse.id,
                ),
            )
            .where(SurveyResponse.id.in_(select(ids.c.id)))
        )
    ).one()
    completed, passed, average_score, average_attempts = row
    pass_mark = quiz_rules(scope).get("pass_mark")
    return {
        "completed": completed,
        "invited": await _invited(session, scope),
        "pass_mark": pass_mark,
        "passed": passed if pass_mark is not None else None,
        "pass_rate": round(passed / completed, 4) if completed and pass_mark is not None else None,
        "average_score": round(float(average_score), 1) if average_score is not None else None,
        "average_attempts": round(float(average_attempts), 1) if average_attempts else None,
        "attempts_to_pass": await _attempts_to_pass(session, scope, ids)
        if pass_mark is not None
        else [],
        "questions": await _percent_correct(session, scope, ids),
        "videos": await _videos(session, scope),
        "due_date": due_date(scope),
    }


async def _invited(session: AsyncSession, scope: Scope) -> int | None:
    if scope.survey.open_to_all:
        return None
    query = select(func.count()).where(
        SurveyAudience.survey_id == scope.survey.id,
        *_people_filter(scope, SurveyAudience.department, SurveyAudience.location),
    )
    return await session.scalar(query) or 0


# --- completion report --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CompletionRow:
    employee_id: str
    name: str | None
    department: str | None
    location: str | None
    status: CompletionStatus
    best_score: int | None
    attempts: int
    completed_at: datetime | None
    late: bool


def _people(scope: Scope) -> Select[Any]:
    """Everyone the report covers: the audience, or (open to all) everyone who took part."""
    survey_id = scope.survey.id
    first_attempt = (
        select(func.min(SurveyResponse.submitted_at))
        .where(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.employee_id == SurveyParticipation.employee_id,
        )
        .correlate(SurveyParticipation)
        .scalar_subquery()
    )
    watched = (
        select(VideoView.employee_id).where(VideoView.survey_id == survey_id).distinct().subquery()
    )
    best = SurveyResponse
    employee: Any
    name: Any
    department: Any
    location: Any
    if scope.survey.open_to_all:
        everyone = union(
            select(SurveyParticipation.employee_id).where(
                SurveyParticipation.survey_id == survey_id
            ),
            select(VideoView.employee_id).where(VideoView.survey_id == survey_id),
        ).subquery()
        employee = everyone.c.employee_id
        name = best.name
        department, location = best.department, best.location
        base = select(employee.label("employee_id")).select_from(everyone)
    else:
        employee = SurveyAudience.employee_id
        name = func.coalesce(SurveyAudience.name, best.name)
        department, location = SurveyAudience.department, SurveyAudience.location
        base = select(employee.label("employee_id")).where(SurveyAudience.survey_id == survey_id)
    return (
        base.add_columns(
            name.label("name"),
            department.label("department"),
            location.label("location"),
            SurveyParticipation.employee_id.label("participant"),
            SurveyParticipation.attempts,
            SurveyParticipation.best_score,
            SurveyParticipation.passed,
            SurveyParticipation.passed_at,
            first_attempt.label("first_attempt_at"),
            watched.c.employee_id.label("watcher"),
        )
        .outerjoin(
            SurveyParticipation,
            and_(
                SurveyParticipation.survey_id == survey_id,
                SurveyParticipation.employee_id == employee,
            ),
        )
        .outerjoin(best, best.id == SurveyParticipation.best_response_id)
        .outerjoin(watched, watched.c.employee_id == employee)
        .where(*_people_filter(scope, department, location))
        .order_by(func.lower(func.coalesce(name, employee)), employee)
    )


def _status(row: Any, has_pass_mark: bool) -> CompletionStatus:
    if row.attempts:
        if not has_pass_mark or row.passed is None:
            return "completed"
        return "passed" if row.passed else "not_passed"
    return (
        "in_progress" if row.participant is not None or row.watcher is not None else "not_started"
    )


async def completion_rows(session: AsyncSession, scope: Scope) -> list[CompletionRow]:
    """Everyone, with their status, best score, attempts, completed date and late flag.

    Completed means passed when there's a pass mark (the date they first passed), otherwise
    the first attempt. Late: completed after the due date, or not completed and past it.
    """
    has_pass_mark = quiz_rules(scope).get("pass_mark") is not None
    due = due_date(scope)
    now = today(scope.settings)
    zone = scope.settings.timezone
    rows: list[CompletionRow] = []
    for row in (await session.execute(_people(scope))).all():
        status = _status(row, has_pass_mark)
        completed_at = (
            row.passed_at if has_pass_mark else (row.first_attempt_at if row.attempts else None)
        )
        late = due is not None and (
            completed_at.astimezone(zone).date() > due if completed_at else now > due
        )
        rows.append(
            CompletionRow(
                employee_id=row.employee_id,
                name=row.name,
                department=row.department,
                location=row.location,
                status=status,
                best_score=row.best_score if row.attempts else None,
                attempts=row.attempts or 0,
                completed_at=completed_at,
                late=late,
            )
        )
    return rows


async def completion_report(
    session: AsyncSession,
    scope: Scope,
    *,
    status: CompletionStatus | None = None,
    page: int = 1,
) -> dict[str, Any]:
    rows = await completion_rows(session, scope)
    counts: dict[str, int] = dict.fromkeys(STATUSES, 0)
    for row in rows:
        counts[row.status] += 1
    chosen = [r for r in rows if status is None or r.status == status]
    start = (page - 1) * COMPLETION_PAGE
    return {
        "total": len(rows),
        "counts": counts,
        "late": sum(1 for r in rows if r.late),
        "matching": len(chosen),
        "page": page,
        "page_size": COMPLETION_PAGE,
        "has_pass_mark": quiz_rules(scope).get("pass_mark") is not None,
        "due_date": due_date(scope),
        "rows": chosen[start : start + COMPLETION_PAGE],
    }
