"""Survey results (docs/07-reports-dashboard.md).

Everything is a live SQL aggregate over the filtered responses. Versions are combined by
question and option key, so a survey republished with the same questions reports as one.

Two rules apply everywhere:
- Percentages use the people *shown* a question as the denominator (response_shown).
- Small groups: if the filters leave fewer than 5 responses, only participation figures are
  returned. Answers, averages and comments are left out of the payload, not just hidden.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, and_, case, distinct, exists, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    QuestionOption,
    ResponseAnswer,
    ResponseShown,
    Survey,
    SurveyAudience,
    SurveyParticipation,
    SurveyResponse,
    SurveyVersion,
    VersionQuestion,
)
from app.services.money import Currency, amount_in_words, format_amount, group_digits
from app.services.respond import today
from app.services.version_content import VersionContent, load_version

MIN_GROUP = 5
TIMELINE_MAX_DAYS = 366
COMMENTS_PAGE = 20
RESPONSES_PAGE = 25
CHOICE_TYPES = ("single", "multi", "dropdown")
TEXT_TYPES = ("short", "long")
MONEY_BUCKETS = (10_000, 25_000, 50_000, 100_000)


@dataclass(frozen=True, slots=True)
class Filters:
    department: str | None = None
    location: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    version: int | None = None
    # question key -> option key: only responses that chose this option
    answers: tuple[tuple[str, str], ...] = ()

    @property
    def any(self) -> bool:
        return bool(
            self.department is not None
            or self.location is not None
            or self.date_from
            or self.date_to
            or self.version
            or self.answers
        )

    def cache_key(self) -> tuple[Any, ...]:
        return (
            self.department,
            self.location,
            self.date_from,
            self.date_to,
            self.version,
            self.answers,
        )


@dataclass(slots=True)
class Scope:
    """A survey, the version whose questions are reported, and the filters."""

    survey: Survey
    version: VersionContent
    filters: Filters
    settings: Settings
    versions: list[dict[str, Any]] = field(default_factory=list)
    compatible: bool = True
    version_applied: int | None = None

    @property
    def anonymous(self) -> bool:
        return bool(self.version.content["settings"].get("anonymous"))


def _local_day(settings: Settings) -> Any:
    return func.date(func.timezone(settings.survey_timezone, SurveyResponse.submitted_at))


def filtered_responses(scope: Scope) -> Select[Any]:
    """IDs of the responses that pass the filters."""
    f = scope.filters
    query = select(SurveyResponse.id).where(SurveyResponse.survey_id == scope.survey.id)
    if scope.version_applied is not None:
        query = query.join(SurveyVersion, SurveyVersion.id == SurveyResponse.version_id).where(
            SurveyVersion.version_no == scope.version_applied
        )
    if f.department is not None:
        query = query.where(
            SurveyResponse.department.is_(None)
            if f.department == ""
            else SurveyResponse.department == f.department
        )
    if f.location is not None:
        query = query.where(
            SurveyResponse.location.is_(None)
            if f.location == ""
            else SurveyResponse.location == f.location
        )
    day = _local_day(scope.settings)
    if f.date_from:
        query = query.where(day >= f.date_from)
    if f.date_to:
        query = query.where(day <= f.date_to)
    for question_key, option_key in f.answers:
        query = query.where(
            exists(
                select(literal(1))
                .select_from(ResponseAnswer)
                .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
                .join(QuestionOption, QuestionOption.id == ResponseAnswer.option_id)
                .where(
                    ResponseAnswer.response_id == SurveyResponse.id,
                    VersionQuestion.key == uuid.UUID(question_key),
                    QuestionOption.key == uuid.UUID(option_key),
                )
            )
        )
    return query


async def _versions(session: AsyncSession, survey_id: uuid.UUID) -> list[dict[str, Any]]:
    responses = (
        select(func.count())
        .select_from(SurveyResponse)
        .where(SurveyResponse.version_id == SurveyVersion.id)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(SurveyVersion.id, SurveyVersion.version_no, SurveyVersion.published_at, responses)
        .where(SurveyVersion.survey_id == survey_id)
        .order_by(SurveyVersion.version_no)
    )
    return [
        {"id": vid, "version_no": no, "published_at": published, "responses": count}
        for vid, no, published, count in rows.all()
    ]


async def _compatible(session: AsyncSession, versions: list[dict[str, Any]]) -> bool:
    """Versions can be combined when they ask the same questions (same keys and types)."""
    if len(versions) < 2:  # noqa: PLR2004
        return True
    rows = await session.execute(
        select(VersionQuestion.version_id, VersionQuestion.key, VersionQuestion.type).where(
            VersionQuestion.version_id.in_([v["id"] for v in versions])
        )
    )
    shapes: dict[uuid.UUID, set[tuple[uuid.UUID, str]]] = defaultdict(set)
    for version_id, key, kind in rows.all():
        shapes[version_id].add((key, kind))
    return len({frozenset(shape) for shape in shapes.values()}) <= 1


async def build_scope(
    session: AsyncSession, settings: Settings, survey: Survey, filters: Filters
) -> Scope:
    if survey.current_version_id is None:
        msg = "Survey has no published version"
        raise LookupError(msg)
    versions = await _versions(session, survey.id)
    compatible = await _compatible(session, versions)
    current_no = next(v["version_no"] for v in versions if v["id"] == survey.current_version_id)
    # "All versions" only when the questions match; otherwise report one version at a time.
    applied = filters.version if filters.version else (None if compatible else current_no)
    report_version = next(
        (v["id"] for v in versions if v["version_no"] == applied), survey.current_version_id
    )
    version = await load_version(session, report_version)
    return Scope(
        survey=survey,
        version=version,
        filters=filters,
        settings=settings,
        versions=[{k: v for k, v in item.items() if k != "id"} for item in versions],
        compatible=compatible,
        version_applied=applied,
    )


async def _count(session: AsyncSession, scope: Scope) -> int:
    ids = filtered_responses(scope).subquery()
    return await session.scalar(select(func.count()).select_from(ids)) or 0


def is_small(count: int) -> bool:
    return count < MIN_GROUP


async def _invited(session: AsyncSession, scope: Scope) -> int | None:
    if scope.survey.open_to_all:
        return None
    query = (
        select(func.count())
        .select_from(SurveyAudience)
        .where(SurveyAudience.survey_id == scope.survey.id)
    )
    f = scope.filters
    if f.department is not None:
        query = query.where(
            SurveyAudience.department.is_(None)
            if f.department == ""
            else SurveyAudience.department == f.department
        )
    if f.location is not None:
        query = query.where(
            SurveyAudience.location.is_(None)
            if f.location == ""
            else SurveyAudience.location == f.location
        )
    return await session.scalar(query) or 0


async def _respondents(session: AsyncSession, scope: Scope) -> int:
    """People (not responses) who have submitted, within the department/location filters.

    Uses participation joined to the audience, so it works for anonymous surveys too.
    """
    query = (
        select(func.count())
        .select_from(SurveyParticipation)
        .where(
            SurveyParticipation.survey_id == scope.survey.id,
            SurveyParticipation.status == "submitted",
        )
    )
    f = scope.filters
    if (f.department is not None or f.location is not None) and not scope.survey.open_to_all:
        query = query.join(
            SurveyAudience,
            and_(
                SurveyAudience.survey_id == SurveyParticipation.survey_id,
                SurveyAudience.employee_id == SurveyParticipation.employee_id,
            ),
        )
        if f.department is not None:
            query = query.where(
                SurveyAudience.department.is_(None)
                if f.department == ""
                else SurveyAudience.department == f.department
            )
        if f.location is not None:
            query = query.where(
                SurveyAudience.location.is_(None)
                if f.location == ""
                else SurveyAudience.location == f.location
            )
    return await session.scalar(query) or 0


def _question_keys(scope: Scope, kind: tuple[str, ...]) -> list[dict[str, Any]]:
    return [q for q in scope.version.content["questions"] if q["type"] in kind]


async def _numeric_stats(session: AsyncSession, scope: Scope, question_key: str) -> dict[str, Any]:
    ids = filtered_responses(scope).subquery()
    row = (
        await session.execute(
            select(
                func.count(ResponseAnswer.id),
                func.sum(ResponseAnswer.value_num),
                func.avg(ResponseAnswer.value_num),
                func.percentile_cont(0.5).within_group(ResponseAnswer.value_num),
                func.min(ResponseAnswer.value_num),
                func.max(ResponseAnswer.value_num),
            )
            .select_from(ResponseAnswer)
            .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
            .where(
                VersionQuestion.key == uuid.UUID(question_key),
                ResponseAnswer.response_id.in_(select(ids.c.id)),
                ResponseAnswer.value_num.is_not(None),
            )
        )
    ).one()
    count, total, average, median, low, high = row
    return {
        "n": count,
        "total": _num(total),
        "average": _num(average),
        "median": _num(median),
        "min": _num(low),
        "max": _num(high),
    }


def _num(value: Any) -> float | None:
    if value is None:
        return None
    return round(float(value), 2)


async def summary(session: AsyncSession, scope: Scope) -> dict[str, Any]:
    responses = await _count(session, scope)
    invited = await _invited(session, scope)
    respondents = await _respondents(session, scope)
    small = is_small(responses)
    rating = next(iter(_question_keys(scope, ("rating",))), None)
    money = next(iter(_question_keys(scope, ("money",))), None)
    headline = None
    money_headline = None
    if not small and rating:
        stats = await _numeric_stats(session, scope, rating["key"])
        if stats["n"]:
            headline = {
                "question_key": rating["key"],
                "text": rating["text"],
                "average": stats["average"],
            }
    if not small and money:
        stats = await _numeric_stats(session, scope, money["key"])
        if stats["n"] and stats["median"] is not None:
            currency: Currency = money["config"].get("currency", "INR")
            money_headline = {
                "question_key": money["key"],
                "text": money["text"],
                "currency": currency,
                "median": stats["median"],
                "median_formatted": format_amount(stats["median"], currency),
                "median_words": amount_in_words(stats["median"], currency),
            }
    ids = filtered_responses(scope).subquery()
    week_ago = today(scope.settings) - timedelta(days=6)
    this_week = await session.scalar(
        select(func.count())
        .select_from(SurveyResponse)
        .where(SurveyResponse.id.in_(select(ids.c.id)), _local_day(scope.settings) >= week_ago)
    )
    last = await session.scalar(
        select(func.max(SurveyResponse.submitted_at)).where(SurveyResponse.id.in_(select(ids.c.id)))
    )
    return {
        "small_group": small,
        "responses": responses,
        "respondents": respondents,
        "invited": invited,
        "response_rate": round(respondents / invited, 4) if invited else None,
        "responses_this_week": this_week or 0,
        "last_response_at": last,
        "headline": headline,
        "money": money_headline,
    }


async def timeline(session: AsyncSession, scope: Scope) -> dict[str, Any]:
    ids = filtered_responses(scope).subquery()
    day = _local_day(scope.settings)
    rows = await session.execute(
        select(day.label("day"), func.count())
        .where(SurveyResponse.id.in_(select(ids.c.id)))
        .group_by("day")
        .order_by("day")
    )
    counts: dict[date, int] = {row[0]: row[1] for row in rows.all()}
    settings = scope.version.content["settings"]
    opens = date.fromisoformat(settings["opens_at"]) if settings.get("opens_at") else None
    closes = date.fromisoformat(settings["closes_at"]) if settings.get("closes_at") else None
    now = today(scope.settings)
    start = scope.filters.date_from or min([d for d in (opens, *counts.keys()) if d] or [now])
    end = scope.filters.date_to or max(
        [d for d in (min(closes, now) if closes else now, *counts.keys()) if d]
    )
    start = max(start, end - timedelta(days=TIMELINE_MAX_DAYS - 1))
    days = []
    cursor = start
    while cursor <= end:
        days.append({"day": cursor, "n": counts.get(cursor, 0)})
        cursor += timedelta(days=1)
    return {"days": days, "reminders": []}


async def participation(session: AsyncSession, scope: Scope) -> dict[str, Any]:
    """Invited, responded and rate per department. Built from participation, never answers."""
    survey_id = scope.survey.id
    if scope.survey.open_to_all:
        # No invitation list: count responses by the department captured at submit.
        rows = await session.execute(
            select(SurveyResponse.department, func.count())
            .where(SurveyResponse.survey_id == survey_id)
            .group_by(SurveyResponse.department)
            .order_by(func.count().desc())
        )
        return {
            "open_to_all": True,
            "departments": [
                {"department": d, "invited": None, "responded": n, "rate": None}
                for d, n in rows.all()
            ],
        }
    submitted = (
        select(SurveyParticipation.employee_id)
        .where(
            SurveyParticipation.survey_id == survey_id,
            SurveyParticipation.employee_id == SurveyAudience.employee_id,
            SurveyParticipation.status == "submitted",
        )
        .exists()
    )
    query = (
        select(
            SurveyAudience.department,
            func.count(),
            func.count().filter(submitted),
        )
        .where(SurveyAudience.survey_id == survey_id)
        .group_by(SurveyAudience.department)
    )
    if scope.filters.location is not None:
        query = query.where(
            SurveyAudience.location.is_(None)
            if scope.filters.location == ""
            else SurveyAudience.location == scope.filters.location
        )
    department_rows = (await session.execute(query)).all()
    departments: list[dict[str, Any]] = [
        {
            "department": department,
            "invited": invited,
            "responded": responded,
            "rate": round(responded / invited, 4) if invited else None,
        }
        for department, invited, responded in department_rows
    ]
    departments.sort(key=lambda d: (-(d["invited"] or 0), d["department"] or ""))
    return {"open_to_all": False, "departments": departments}


def _range_label(index: int, currency: Currency) -> str:
    def bare(value: int) -> str:
        return group_digits(str(value), indian=currency == "INR")

    if index == 0:
        return f"Under {format_amount(MONEY_BUCKETS[0], currency)}"
    if index == len(MONEY_BUCKETS):
        return f"{format_amount(MONEY_BUCKETS[-1], currency)} and above"
    low, high = format_amount(MONEY_BUCKETS[index - 1], currency), bare(MONEY_BUCKETS[index])
    return f"{low}–{high}"  # noqa: RUF001 - en dash, as in the docs


async def questions(session: AsyncSession, scope: Scope) -> dict[str, Any]:
    count = await _count(session, scope)
    content = scope.version.content
    if is_small(count):
        return {"small_group": True, "responses": count, "sections": []}

    ids = filtered_responses(scope).subquery()
    in_scope = SurveyResponse.id.in_(select(ids.c.id))

    shown_rows = await session.execute(
        select(VersionQuestion.key, func.count(distinct(ResponseShown.response_id)))
        .select_from(ResponseShown)
        .join(VersionQuestion, VersionQuestion.id == ResponseShown.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseShown.response_id)
        .where(in_scope)
        .group_by(VersionQuestion.key)
    )
    shown = {str(k): n for k, n in shown_rows.all()}
    answered_rows = await session.execute(
        select(VersionQuestion.key, func.count(distinct(ResponseAnswer.response_id)))
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(in_scope)
        .group_by(VersionQuestion.key)
    )
    answered = {str(k): n for k, n in answered_rows.all()}
    option_rows = await session.execute(
        select(VersionQuestion.key, QuestionOption.key, func.count())
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(QuestionOption, QuestionOption.id == ResponseAnswer.option_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(in_scope)
        .group_by(VersionQuestion.key, QuestionOption.key)
    )
    option_counts: dict[str, dict[str, int]] = defaultdict(dict)
    for q_key, o_key, n in option_rows.all():
        option_counts[str(q_key)][str(o_key)] = n
    rating_rows = await session.execute(
        select(VersionQuestion.key, ResponseAnswer.value_num, func.count())
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(in_scope, VersionQuestion.type == "rating")
        .group_by(VersionQuestion.key, ResponseAnswer.value_num)
    )
    rating_counts: dict[str, dict[int, int]] = defaultdict(dict)
    for q_key, value, n in rating_rows.all():
        if value is not None:
            rating_counts[str(q_key)][int(value)] = n
    bucket = case(
        *[(ResponseAnswer.value_num < edge, i) for i, edge in enumerate(MONEY_BUCKETS)],
        else_=len(MONEY_BUCKETS),
    )
    range_rows = await session.execute(
        select(VersionQuestion.key, bucket.label("bucket"), func.count())
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(in_scope, VersionQuestion.type == "money")
        .group_by(VersionQuestion.key, "bucket")
    )
    range_counts: dict[str, dict[int, int]] = defaultdict(dict)
    for q_key, index, n in range_rows.all():
        range_counts[str(q_key)][int(index)] = n

    sections_out: list[dict[str, Any]] = []
    by_section: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for number, question in enumerate(content["questions"], start=1):
        key = question["key"]
        q_shown = shown.get(key, 0)
        q_answered = answered.get(key, 0)
        item: dict[str, Any] = {
            "key": key,
            "number": number,
            "type": question["type"],
            "text": question["text"],
            "required": question["required"],
            "condition": question["condition"],
            "shown": q_shown,
            "answered": q_answered,
        }
        kind = question["type"]
        if kind in CHOICE_TYPES:
            counts = option_counts.get(key, {})
            item["options"] = [
                {
                    "key": o["key"],
                    "label": o["label"],
                    "n": counts.get(o["key"], 0),
                    "share": round(counts.get(o["key"], 0) / q_shown, 4) if q_shown else 0,
                }
                for o in question["options"]
            ]
        elif kind == "rating":
            stats = await _numeric_stats(session, scope, key)
            counts_r = rating_counts.get(key, {})
            item["average"] = stats["average"]
            item["distribution"] = [
                {
                    "value": v,
                    "n": counts_r.get(v, 0),
                    "share": round(counts_r.get(v, 0) / q_shown, 4) if q_shown else 0,
                }
                for v in range(1, 6)
            ]
        elif kind == "money":
            currency: Currency = question["config"].get("currency", "INR")
            stats = await _numeric_stats(session, scope, key)
            item["currency"] = currency
            item["stats"] = {
                **{k: stats[k] for k in ("total", "average", "median", "min", "max")},
                "average_words": amount_in_words(stats["average"], currency)
                if stats["average"] is not None
                else None,
                "median_words": amount_in_words(stats["median"], currency)
                if stats["median"] is not None
                else None,
            }
            counts_m = range_counts.get(key, {})
            item["ranges"] = [
                {
                    "label": _range_label(i, currency),
                    "n": counts_m.get(i, 0),
                    "share": round(counts_m.get(i, 0) / q_answered, 4) if q_answered else 0,
                }
                for i in range(len(MONEY_BUCKETS) + 1)
            ]
        by_section[question["section_key"]].append(item)
    for section in content["sections"]:
        sections_out.append(
            {
                "key": section["key"],
                "title": section["title"],
                "description": section["description"],
                "condition": section["condition"],
                "questions": by_section.get(section["key"], []),
            }
        )
    return {"small_group": False, "responses": count, "sections": sections_out}


async def comments(
    session: AsyncSession,
    scope: Scope,
    *,
    question_key: str | None,
    search: str | None,
    page: int,
) -> dict[str, Any]:
    count = await _count(session, scope)
    if is_small(count):
        return {
            "small_group": True,
            "total": 0,
            "page": page,
            "page_size": COMMENTS_PAGE,
            "items": [],
        }
    ids = filtered_responses(scope).subquery()
    text_questions = {q["key"]: q for q in _question_keys(scope, TEXT_TYPES)}
    numbers = {q["key"]: i for i, q in enumerate(scope.version.content["questions"], start=1)}
    wanted = [uuid.UUID(k) for k in text_questions if question_key in (None, k)]
    query = (
        select(
            VersionQuestion.key,
            ResponseAnswer.value_text,
            SurveyResponse.department,
            SurveyResponse.location,
            SurveyResponse.submitted_at,
            SurveyResponse.employee_id,
        )
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(
            SurveyResponse.id.in_(select(ids.c.id)),
            VersionQuestion.key.in_(wanted),
            ResponseAnswer.value_text.is_not(None),
        )
    )
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(ResponseAnswer.value_text.ilike(f"%{escaped}%"))
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.execute(
        query.order_by(SurveyResponse.submitted_at.desc(), ResponseAnswer.id)
        .limit(COMMENTS_PAGE)
        .offset((page - 1) * COMMENTS_PAGE)
    )
    names = await _names(session, scope.survey.id)
    items = []
    for key, text, department, location, submitted_at, employee_id in rows.all():
        items.append(
            {
                "question_key": str(key),
                "number": numbers.get(str(key)),
                "text": text,
                "department": department,
                "location": location,
                # Anonymous surveys: no names, and only the day.
                "submitted_on": submitted_at.astimezone(scope.settings.timezone).date(),
                "employee": None
                if scope.anonymous or employee_id is None
                else {"employee_id": employee_id, "name": names.get(employee_id)},
            }
        )
    return {
        "small_group": False,
        "total": total,
        "page": page,
        "page_size": COMMENTS_PAGE,
        "items": items,
    }


async def _names(session: AsyncSession, survey_id: uuid.UUID) -> dict[str, str | None]:
    rows = await session.execute(
        select(SurveyAudience.employee_id, SurveyAudience.name).where(
            SurveyAudience.survey_id == survey_id
        )
    )
    return {row[0]: row[1] for row in rows.all()}


def _response_rows_query(scope: Scope) -> Any:
    ids = filtered_responses(scope).subquery()
    return (
        select(
            SurveyResponse.id,
            SurveyResponse.employee_id,
            SurveyResponse.department,
            SurveyResponse.location,
            SurveyResponse.submitted_at,
            SurveyVersion.version_no,
        )
        .join(SurveyVersion, SurveyVersion.id == SurveyResponse.version_id)
        .where(SurveyResponse.id.in_(select(ids.c.id)))
        .order_by(SurveyResponse.submitted_at.desc(), SurveyResponse.id)
    )


async def _response_rows(
    session: AsyncSession, scope: Scope, *, limit: int | None = None, offset: int = 0
) -> list[dict[str, Any]]:
    query = _response_rows_query(scope)
    if limit is not None:
        query = query.limit(limit).offset(offset)
    rows = await session.execute(query)
    names = await _names(session, scope.survey.id)
    return [
        {
            "id": rid,
            "employee_id": employee_id,
            "name": names.get(employee_id or ""),
            "department": department,
            "location": location,
            "submitted_at": submitted_at,
            "version_no": version_no,
        }
        for rid, employee_id, department, location, submitted_at, version_no in rows.all()
    ]


async def responses_list(session: AsyncSession, scope: Scope, *, page: int) -> dict[str, Any]:
    """Individual responses, newest first. Callers must refuse anonymous surveys first."""
    total = await _count(session, scope)
    items = await _response_rows(
        session, scope, limit=RESPONSES_PAGE, offset=(page - 1) * RESPONSES_PAGE
    )
    return {"total": total, "page": page, "page_size": RESPONSES_PAGE, "items": items}


async def all_responses(session: AsyncSession, scope: Scope) -> list[dict[str, Any]]:
    """Every filtered response (for the export's Responses sheet)."""
    return await _response_rows(session, scope)


def display_answer(question: dict[str, Any], value: Any) -> str:
    """An answer as people read it: option labels, "4 / 5", "₹1,25,000"."""
    if value is None:
        return ""
    labels = {o["key"]: o["label"] for o in question.get("options", [])}
    kind = question["type"]
    if kind == "multi":
        return "; ".join(labels.get(v, "") for v in value)
    if kind in ("single", "dropdown"):
        return str(labels.get(value, ""))
    if kind == "rating":
        return f"{value} / 5"
    if kind == "money":
        return format_amount(value, question["config"].get("currency", "INR"))
    return str(value)


async def response_detail(
    session: AsyncSession, scope: Scope, response_id: uuid.UUID
) -> dict[str, Any] | None:
    from app.services.respond import response_answers  # noqa: PLC0415 - avoid a cycle

    response = await session.get(SurveyResponse, response_id)
    if response is None or response.survey_id != scope.survey.id:
        return None
    version = await load_version(session, response.version_id)
    answers = await response_answers(session, version, response.id)
    shown_ids = set(
        (
            await session.scalars(
                select(ResponseShown.question_id).where(ResponseShown.response_id == response.id)
            )
        ).all()
    )
    names = await _names(session, scope.survey.id)
    items = []
    for number, question in enumerate(version.content["questions"], start=1):
        ref = version.questions[question["key"]]
        if ref.id not in shown_ids:
            continue
        value = answers.get(question["key"])
        items.append(
            {
                "key": question["key"],
                "number": number,
                "type": question["type"],
                "text": question["text"],
                "answer": display_answer(question, value),
                "value": value,
            }
        )
    version_no = await session.scalar(
        select(SurveyVersion.version_no).where(SurveyVersion.id == response.version_id)
    )
    return {
        "id": response.id,
        "employee_id": response.employee_id,
        "name": names.get(response.employee_id or ""),
        "department": response.department,
        "location": response.location,
        "submitted_at": response.submitted_at,
        "version_no": version_no,
        "answers": items,
    }


async def filter_options(session: AsyncSession, survey_id: uuid.UUID) -> dict[str, list[str]]:
    """Departments and locations to offer as filters: from the audience and the responses."""
    out: dict[str, list[str]] = {}
    for name, audience_col, response_col in (
        ("departments", SurveyAudience.department, SurveyResponse.department),
        ("locations", SurveyAudience.location, SurveyResponse.location),
    ):
        a = await session.scalars(
            select(audience_col)
            .where(SurveyAudience.survey_id == survey_id, audience_col.is_not(None))
            .distinct()
        )
        r = await session.scalars(
            select(response_col)
            .where(SurveyResponse.survey_id == survey_id, response_col.is_not(None))
            .distinct()
        )
        out[name] = sorted({value for value in (*a.all(), *r.all()) if value is not None})
    return out


async def non_responders(session: AsyncSession, scope: Scope) -> list[SurveyAudience]:
    submitted = (
        select(SurveyParticipation.employee_id)
        .where(
            SurveyParticipation.survey_id == scope.survey.id,
            SurveyParticipation.employee_id == SurveyAudience.employee_id,
            SurveyParticipation.status == "submitted",
        )
        .exists()
    )
    query = select(SurveyAudience).where(SurveyAudience.survey_id == scope.survey.id, ~submitted)
    f = scope.filters
    if f.department is not None:
        query = query.where(
            SurveyAudience.department.is_(None)
            if f.department == ""
            else SurveyAudience.department == f.department
        )
    if f.location is not None:
        query = query.where(
            SurveyAudience.location.is_(None)
            if f.location == ""
            else SurveyAudience.location == f.location
        )
    rows = await session.scalars(
        query.order_by(SurveyAudience.department.nulls_last(), SurveyAudience.employee_id)
    )
    return list(rows.all())


async def text_answers_for_export(
    session: AsyncSession, scope: Scope
) -> list[tuple[str, str | None, str | None]]:
    """(question key, text, department) for every comment, newest first."""
    ids = filtered_responses(scope).subquery()
    rows = await session.execute(
        select(VersionQuestion.key, ResponseAnswer.value_text, SurveyResponse.department)
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .join(SurveyResponse, SurveyResponse.id == ResponseAnswer.response_id)
        .where(
            SurveyResponse.id.in_(select(ids.c.id)),
            VersionQuestion.type.in_(TEXT_TYPES),
            ResponseAnswer.value_text.is_not(None),
        )
        .order_by(SurveyResponse.submitted_at.desc())
    )
    return [(str(k), t, d) for k, t, d in rows.all()]


async def all_answers(session: AsyncSession, scope: Scope) -> dict[uuid.UUID, dict[str, Any]]:
    """Every filtered response's answers keyed by question key (for the Responses sheet)."""
    ids = filtered_responses(scope).subquery()
    rows = await session.execute(
        select(
            ResponseAnswer.response_id,
            VersionQuestion.key,
            VersionQuestion.type,
            QuestionOption.key,
            ResponseAnswer.value_num,
            ResponseAnswer.value_text,
        )
        .select_from(ResponseAnswer)
        .join(VersionQuestion, VersionQuestion.id == ResponseAnswer.question_id)
        .outerjoin(QuestionOption, QuestionOption.id == ResponseAnswer.option_id)
        .where(ResponseAnswer.response_id.in_(select(ids.c.id)))
        .order_by(ResponseAnswer.response_id, VersionQuestion.sort_order, QuestionOption.sort_order)
    )
    out: dict[uuid.UUID, dict[str, Any]] = defaultdict(dict)
    for response_id, q_key, kind, o_key, num, text in rows.all():
        key = str(q_key)
        if kind == "multi":
            out[response_id].setdefault(key, []).append(str(o_key))
        elif kind in CHOICE_TYPES:
            out[response_id][key] = str(o_key)
        elif kind == "rating" and num is not None:
            out[response_id][key] = int(num)
        elif kind == "money" and isinstance(num, Decimal):
            out[response_id][key] = float(num)
        else:
            out[response_id][key] = text
    return out
