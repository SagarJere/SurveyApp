"""Taking surveys (docs/04-api.md, "Respondent"; docs/06-respondent-experience.md).

Every call re-checks access on the server: the survey is published, the person is in the
audience (or it's open to all), and today is inside the open/close dates.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import status
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthenticatedUser
from app.config import Settings
from app.errors import AppError
from app.models import (
    ResponseAnswer,
    ResponseShown,
    Survey,
    SurveyAudience,
    SurveyParticipation,
    SurveyResponse,
)
from app.services.answers import (
    REQUIRED_MESSAGE,
    clean_draft,
    clean_value,
    invalid_message,
    is_invalid,
    range_error,
)
from app.services.results_cache import results_cache
from app.services.survey_logic import evaluate, is_answered
from app.services.version_content import VersionContent, load_version

Window = Literal["open", "not_open", "closed"]
ParticipationStatus = Literal["not_started", "in_progress", "submitted"]
SECONDS_PER_QUESTION = 20


def _day_month(value: date) -> str:
    return f"{value.day} {value:%b}"


def _parse_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def today(settings: Settings) -> date:
    return datetime.now(settings.timezone).date()


def window(settings: Settings, survey: Survey, version_settings: dict[str, Any]) -> Window:
    """Open between the open date and the end of the close date, in the survey time zone."""
    if survey.status == "closed":
        return "closed"
    now = today(settings)
    opens, closes = (
        _parse_date(version_settings.get("opens_at")),
        _parse_date(version_settings.get("closes_at")),
    )
    if closes and now > closes:
        return "closed"
    if opens and now < opens:
        return "not_open"
    return "open"


async def close_if_expired(
    session: AsyncSession, settings: Settings, survey: Survey, version_settings: dict[str, Any]
) -> None:
    """Surveys close automatically after their close date (docs/01, Survey lifecycle)."""
    if survey.status == "published" and window(settings, survey, version_settings) == "closed":
        await session.execute(
            update(Survey)
            .where(Survey.id == survey.id, Survey.status == "published")
            .values(status="closed", closed_at=func.clock_timestamp())
        )
        await session.commit()
        await session.refresh(survey)


def _unavailable() -> AppError:
    return AppError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="NOT_IN_AUDIENCE",
        message="This survey isn't available to you. If you think that's a mistake, contact HR.",
    )


@dataclass(slots=True)
class RespondentContext:
    survey: Survey
    version: VersionContent
    member: SurveyAudience | None
    participation: SurveyParticipation | None

    @property
    def settings(self) -> dict[str, Any]:
        settings: dict[str, Any] = self.version.content["settings"]
        return settings

    @property
    def anonymous(self) -> bool:
        return bool(self.settings.get("anonymous"))

    def can_edit(self, open_now: bool) -> bool:
        """Editing a submitted response: allowed by the survey, still open, and traceable to
        this person (anonymous responses aren't linked to anyone, so they can't be edited)."""
        p = self.participation
        return (
            open_now
            and bool(self.settings.get("allow_edit"))
            and not self.anonymous
            and p is not None
            and p.status == "submitted"
            and p.response_id is not None
        )


async def respondent_context(
    session: AsyncSession,
    settings: Settings,
    user: AuthenticatedUser,
    survey_id: uuid.UUID,
    *,
    require_open: bool = True,
) -> RespondentContext:
    survey = await session.get(Survey, survey_id)
    if survey is None or survey.current_version_id is None or survey.status == "draft":
        raise _unavailable()
    version = await load_version(session, survey.current_version_id)
    await close_if_expired(session, settings, survey, version.content["settings"])
    member = await session.get(SurveyAudience, (survey.id, user.employee_id))
    if not survey.open_to_all and member is None:
        raise _unavailable()
    participation = await session.get(SurveyParticipation, (survey.id, user.employee_id))
    context = RespondentContext(survey, version, member, participation)
    if require_open:
        state = window(settings, survey, context.settings)
        if state == "not_open":
            opens = _parse_date(context.settings.get("opens_at"))
            raise AppError(
                status_code=status.HTTP_410_GONE,
                code="NOT_OPEN_YET",
                message=f"This survey opens on {_day_month(opens) if opens else 'a later date'}.",
                details={"opens_at": opens.isoformat() if opens else None},
            )
        if state == "closed":
            closed_on = _parse_date(context.settings.get("closes_at"))
            if survey.closed_at is not None:
                closed_at_day = survey.closed_at.astimezone(settings.timezone).date()
                closed_on = min(closed_on, closed_at_day) if closed_on else closed_at_day
            raise AppError(
                status_code=status.HTTP_410_GONE,
                code="SURVEY_CLOSED",
                message=(
                    f"This survey closed on {_day_month(closed_on)}. Thanks for your interest."
                    if closed_on
                    else "This survey has closed. Thanks for your interest."
                ),
                details={"closed_on": closed_on.isoformat() if closed_on else None},
            )
    return context


# --- reading answers back --------------------------------------------------------------------


async def response_answers(
    session: AsyncSession, version: VersionContent, response_id: uuid.UUID
) -> dict[str, Any]:
    """A stored response as the answers payload, keyed by question key."""
    by_id = {ref.id: ref for ref in version.questions.values()}
    option_key = {
        option_id: key
        for ref in version.questions.values()
        for key, option_id in ref.option_ids.items()
    }
    rows = (
        await session.execute(
            select(ResponseAnswer)
            .where(ResponseAnswer.response_id == response_id)
            .order_by(ResponseAnswer.id)
        )
    ).scalars()
    answers: dict[str, Any] = {}
    for row in rows:
        ref = by_id.get(row.question_id)
        if ref is None:
            continue  # the response was on another version; Phase 4 edits always move it forward
        if ref.type == "multi":
            if row.option_id in option_key:
                answers.setdefault(ref.key, []).append(option_key[row.option_id])
        elif ref.type in ("single", "dropdown"):
            if row.option_id in option_key:
                answers[ref.key] = option_key[row.option_id]
        elif ref.type == "rating" and row.value_num is not None:
            answers[ref.key] = int(row.value_num)
        elif ref.type == "money" and row.value_num is not None:
            answers[ref.key] = float(row.value_num)
        elif ref.type == "number" and row.value_num is not None:
            value = float(row.value_num)
            answers[ref.key] = int(value) if value.is_integer() else value
        elif row.value_text is not None:
            answers[ref.key] = row.value_text
    for ref in version.questions.values():  # checkboxes in display order
        if ref.type == "multi" and ref.key in answers:
            chosen = set(answers[ref.key])
            answers[ref.key] = [k for k in ref.option_ids if k in chosen]
    return answers


# --- GET /respond/{id} ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RespondentView:
    context: RespondentContext
    status: ParticipationStatus
    answers: dict[str, Any]
    can_edit: bool
    can_respond_again: bool
    draft_updated: bool


async def respondent_view(
    session: AsyncSession, settings: Settings, user: AuthenticatedUser, survey_id: uuid.UUID
) -> RespondentView:
    context = await respondent_context(session, settings, user, survey_id)
    p = context.participation
    can_edit = context.can_edit(open_now=True)
    if p is None:
        return RespondentView(context, "not_started", {}, False, False, draft_updated=False)
    current = context.version.version.id
    answers: dict[str, Any] = {}
    if p.status == "submitted" and can_edit and p.response_id is not None and not p.draft_answers:
        answers = await response_answers(session, context.version, p.response_id)
    elif p.draft_answers:
        answers = clean_draft(context.version.questions, p.draft_answers)
    draft_updated = bool(p.draft_answers) and p.draft_version_id not in (None, current)
    return RespondentView(
        context,
        "submitted" if p.status == "submitted" else "in_progress",
        answers,
        can_edit,
        can_respond_again=p.status == "submitted"
        and not context.settings.get("one_response", True),
        draft_updated=draft_updated,
    )


# --- PUT /respond/{id}/draft ----------------------------------------------------------------


MAX_DRAFT_KEYS = 1000


async def save_draft(
    session: AsyncSession,
    settings: Settings,
    user: AuthenticatedUser,
    survey_id: uuid.UUID,
    answers: dict[str, Any],
) -> datetime:
    context = await respondent_context(session, settings, user, survey_id)
    p = context.participation
    if (
        p is not None
        and p.status == "submitted"
        and context.settings.get("one_response", True)
        and not context.can_edit(open_now=True)
    ):
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_SUBMITTED",
            message="You've already responded to this survey.",
        )
    cleaned = clean_draft(context.version.questions, dict(list(answers.items())[:MAX_DRAFT_KEYS]))
    version_id = context.version.version.id
    statement = pg_insert(SurveyParticipation).values(
        survey_id=survey_id,
        employee_id=user.employee_id,
        status="in_progress",
        draft_answers=cleaned,
        draft_version_id=version_id,
    )
    upsert = statement.on_conflict_do_update(
        index_elements=[SurveyParticipation.survey_id, SurveyParticipation.employee_id],
        set_={
            "draft_answers": cleaned,
            "draft_version_id": version_id,
            "updated_at": func.clock_timestamp(),
        },
    ).returning(SurveyParticipation.updated_at)
    saved: datetime = (await session.execute(upsert)).scalar_one()
    await session.commit()
    return saved


# --- POST /respond/{id}/submit --------------------------------------------------------------


def check_answers(
    version: VersionContent, raw: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[dict[str, str]]]:
    """Returns (answers to store, visible question keys, problems).

    Answers to hidden questions are dropped, whatever the browser sent. Problems are reported
    only for visible questions: a wrong value, an amount out of range, or a missing required
    answer.
    """
    valid: dict[str, Any] = {}
    invalid: dict[str, str] = {}
    for key, value in raw.items():
        ref = version.questions.get(key)
        if ref is None:
            continue  # not in this version
        cleaned = clean_value(ref, value)
        if is_invalid(cleaned):
            invalid[key] = invalid_message(cleaned)
        elif cleaned is not None:
            valid[key] = cleaned
    visibility = evaluate(version.logic, valid)
    visible = set(visibility.visible_questions)
    problems: list[dict[str, str]] = []
    for key in visibility.visible_questions:
        ref = version.questions[key]
        if key in invalid:
            problems.append({"question_key": key, "message": invalid[key]})
        elif key in visibility.missing_required:
            problems.append({"question_key": key, "message": REQUIRED_MESSAGE})
        elif key in valid and (error := range_error(ref, valid[key])):
            problems.append({"question_key": key, "message": error})
    kept = {k: v for k, v in visibility.kept_answers.items() if k in visible and is_answered(v)}
    return kept, visibility.visible_questions, problems


@dataclass(frozen=True, slots=True)
class Submitted:
    submitted_at: datetime
    can_edit: bool
    can_respond_again: bool


def _hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


async def submit(
    session: AsyncSession,
    settings: Settings,
    user: AuthenticatedUser,
    survey_id: uuid.UUID,
    raw_answers: dict[str, Any],
) -> Submitted:
    context = await respondent_context(session, settings, user, survey_id)
    version = context.version
    answers, visible, problems = check_answers(version, raw_answers)
    if problems:
        count = len(problems)
        raise AppError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_FAILED",
            message=f"Check {count} answer{'s' if count > 1 else ''} before submitting.",
            details={"issues": problems},
        )

    # One transaction from here. Lock this person's participation row so two submits (two
    # tabs, a double click) can't both get through.
    await session.execute(
        pg_insert(SurveyParticipation)
        .values(survey_id=survey_id, employee_id=user.employee_id, status="in_progress")
        .on_conflict_do_nothing()
    )
    participation = await session.scalar(
        select(SurveyParticipation)
        .where(
            SurveyParticipation.survey_id == survey_id,
            SurveyParticipation.employee_id == user.employee_id,
        )
        .with_for_update()
    )
    assert participation is not None  # noqa: S101 - inserted above
    context.participation = participation
    one_response = bool(context.settings.get("one_response", True))
    editing = participation.status == "submitted" and context.can_edit(open_now=True)
    if participation.status == "submitted" and one_response and not editing:
        await session.rollback()
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_SUBMITTED",
            message="You've already responded to this survey.",
        )

    now = datetime.now(UTC)
    anonymous = context.anonymous
    # Anonymous: no employee ID on the response, and times rounded to the hour so they can't
    # be matched to the participation record.
    stamp = _hour(now) if anonymous else now
    member = context.member

    if editing and participation.response_id is not None:
        response_id = participation.response_id
        await session.execute(
            delete(ResponseAnswer).where(ResponseAnswer.response_id == response_id)
        )
        await session.execute(delete(ResponseShown).where(ResponseShown.response_id == response_id))
        await session.execute(
            update(SurveyResponse)
            .where(SurveyResponse.id == response_id)
            .values(
                version_id=version.version.id,
                updated_at=now,
                name=None if anonymous else user.name,
            )
        )
    else:
        response_id = uuid.uuid4()
        await session.execute(
            insert(SurveyResponse).values(
                id=response_id,
                survey_id=survey_id,
                version_id=version.version.id,
                employee_id=None if anonymous else user.employee_id,
                name=None if anonymous else user.name,
                department=member.department if member else None,
                location=member.location if member else None,
                submitted_at=stamp,
                updated_at=stamp,
            )
        )

    answer_rows: list[dict[str, Any]] = []
    for key, value in answers.items():
        ref = version.questions[key]
        base = {"response_id": response_id, "question_id": ref.id}
        if ref.type == "multi":
            answer_rows.extend({**base, "option_id": ref.option_ids[k]} for k in value)
        elif ref.type in ("single", "dropdown"):
            answer_rows.append({**base, "option_id": ref.option_ids[value]})
        elif ref.type in ("rating", "money", "number"):
            answer_rows.append({**base, "value_num": Decimal(str(value))})
        else:
            answer_rows.append({**base, "value_text": value})
    if answer_rows:
        await session.execute(insert(ResponseAnswer), answer_rows)
    shown_rows = [
        {"response_id": response_id, "question_id": version.questions[k].id} for k in visible
    ]
    if shown_rows:
        await session.execute(insert(ResponseShown), shown_rows)

    await session.execute(
        update(SurveyParticipation)
        .where(
            SurveyParticipation.survey_id == survey_id,
            SurveyParticipation.employee_id == user.employee_id,
        )
        .values(
            status="submitted",
            submitted_at=stamp,
            updated_at=stamp,
            draft_answers={},
            draft_version_id=None,
            response_id=None if anonymous else response_id,
        )
    )
    await session.commit()
    results_cache.invalidate(survey_id)
    context.participation = await session.get(SurveyParticipation, (survey_id, user.employee_id))
    return Submitted(
        submitted_at=stamp,
        can_edit=context.can_edit(open_now=True),
        can_respond_again=not one_response,
    )


async def my_response(
    session: AsyncSession, settings: Settings, user: AuthenticatedUser, survey_id: uuid.UUID
) -> dict[str, Any]:
    context = await respondent_context(session, settings, user, survey_id, require_open=False)
    p = context.participation
    if context.anonymous:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            message="Anonymous responses aren't linked to you, so they can't be shown.",
        )
    if p is None or p.status != "submitted" or p.response_id is None:
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="You haven't responded yet.")
    return await response_answers(session, context.version, p.response_id)


# --- GET /me/surveys -----------------------------------------------------------------------


async def my_surveys(
    session: AsyncSession, settings: Settings, user: AuthenticatedUser
) -> list[dict[str, Any]]:
    """Surveys this person can take now, plus ones they've completed."""
    in_audience = (
        select(SurveyAudience.employee_id)
        .where(
            SurveyAudience.survey_id == Survey.id, SurveyAudience.employee_id == user.employee_id
        )
        .exists()
    )
    rows = await session.execute(
        select(Survey, SurveyParticipation)
        .outerjoin(
            SurveyParticipation,
            (SurveyParticipation.survey_id == Survey.id)
            & (SurveyParticipation.employee_id == user.employee_id),
        )
        .where(
            Survey.current_version_id.is_not(None),
            Survey.status.in_(("published", "closed")),
            Survey.open_to_all | in_audience,
        )
        .order_by(Survey.updated_at.desc())
    )
    items: list[dict[str, Any]] = []
    for survey, participation in rows.all():
        assert survey.current_version_id is not None  # noqa: S101 - filtered above
        version = await load_version(session, survey.current_version_id)
        version_settings = version.content["settings"]
        await close_if_expired(session, settings, survey, version_settings)
        state = window(settings, survey, version_settings)
        submitted = participation is not None and participation.status == "submitted"
        if state != "open" and not submitted:
            continue  # not open yet, or closed without a response from them
        visibility = evaluate(version.logic, {})
        answered = 0
        if participation is not None and participation.status == "in_progress":
            draft = clean_draft(version.questions, participation.draft_answers)
            visibility = evaluate(version.logic, draft)
            answered = len(visibility.kept_answers)
        total = len(visibility.visible_questions)
        items.append(
            {
                "id": survey.id,
                "title": version.content["title"],
                "description": version.content["description"],
                "status": "submitted"
                if submitted
                else ("in_progress" if participation is not None else "pending"),
                "open": state == "open",
                "closes_at": _parse_date(version_settings.get("closes_at")),
                "minutes": max(1, round(total * SECONDS_PER_QUESTION / 60)),
                "progress": round(answered / total, 2) if total and not submitted else None,
                "theme": version.content["theme"],
                "submitted_at": participation.submitted_at if submitted and participation else None,
            }
        )
    return items
