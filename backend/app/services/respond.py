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
from app.services.numbers import format_number
from app.services.results_cache import results_cache
from app.services.scoring import Score, attempts_left, passed, score_attempt, show_answers
from app.services.survey_logic import evaluate, is_answered
from app.services.version_content import VersionContent, load_version
from app.services.videos import Progress, progress_for

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


def _no_attempts_left() -> AppError:
    return AppError(
        status_code=status.HTTP_409_CONFLICT,
        code="NO_ATTEMPTS_LEFT",
        message="You've used all your attempts at this training.",
    )


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

    @property
    def training(self) -> bool:
        return self.survey.kind == "training"

    @property
    def quiz_rules(self) -> dict[str, Any]:
        rules: dict[str, Any] = self.settings.get("quiz") or {}
        return rules

    def attempts_left(self) -> int | None:
        """Trainings: attempts still allowed (None = no limit)."""
        p = self.participation
        if p is None:
            return attempts_left(self.quiz_rules, 0, None, None)
        return attempts_left(self.quiz_rules, p.attempts, p.best_score, p.passed)

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
    if context.training:
        # A retake started (answers saved since the last attempt) carries on as in progress.
        more = p.status == "submitted" and context.attempts_left() != 0
        retaking = more and bool(p.draft_answers)
        return RespondentView(
            context,
            "in_progress" if p.status != "submitted" or retaking else "submitted",
            answers,
            can_edit=False,
            can_respond_again=more,
            draft_updated=draft_updated,
        )
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
    if p is not None and p.status == "submitted" and context.training:
        if context.attempts_left() == 0:
            raise _no_attempts_left()
    elif (
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
class AttemptResult:
    """A training attempt as the person may see it. Score fields are None when the creator
    hides the score; `review` is None unless the creator's rule allows it now."""

    attempt_no: int
    score: int | None
    points: int | None
    max_points: int | None
    passed: bool | None
    pass_mark: int | None
    attempts_used: int
    attempts_left: int | None
    review: list[dict[str, Any]] | None


@dataclass(frozen=True, slots=True)
class Submitted:
    submitted_at: datetime
    can_edit: bool
    can_respond_again: bool
    training: AttemptResult | None = None


def _hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


WATCH_FIRST_MESSAGE = "Watch this section's video to the end before answering."


def video_problems(
    version: VersionContent,
    visible: list[str],
    answers: dict[str, Any],
    progress: dict[str, Progress],
) -> list[dict[str, str]]:
    """Trainings: questions in a section whose video isn't finished can't be answered yet.

    Only answered or required questions are reported; an optional question left empty is fine.
    """
    unwatched = {
        section["key"]
        for section in version.content["sections"]
        if section.get("video")
        and not (section["key"] in progress and progress[section["key"]].completed)
    }
    if not unwatched:
        return []
    section_of = {q["key"]: q["section_key"] for q in version.content["questions"]}
    required = {q["key"] for q in version.content["questions"] if q["required"]}
    return [
        {"question_key": key, "message": WATCH_FIRST_MESSAGE}
        for key in visible
        if section_of.get(key) in unwatched and (key in answers or key in required)
    ]


def merge_video_problems(
    problems: list[dict[str, str]], watch: list[dict[str, str]]
) -> list[dict[str, str]]:
    """One message per question: "watch the video first" replaces e.g. "required"."""
    blocked = {p["question_key"] for p in watch}
    return [p for p in problems if p["question_key"] not in blocked] + watch


def _refusal(
    context: RespondentContext, participation: SurveyParticipation, *, editing: bool
) -> AppError | None:
    """Why this person can't submit again, if they can't."""
    if participation.status != "submitted":
        return None
    if context.training:
        return _no_attempts_left() if context.attempts_left() == 0 else None
    if context.settings.get("one_response", True) and not editing:
        return AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_SUBMITTED",
            message="You've already responded to this survey.",
        )
    return None


async def _next_attempt_no(
    session: AsyncSession, survey_id: uuid.UUID, user: AuthenticatedUser
) -> int:
    """1, 2, 3… per person: training attempts, or repeat responses to a survey."""
    previous = await session.scalar(
        select(func.max(SurveyResponse.attempt_no)).where(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.employee_id == user.employee_id,
        )
    )
    return (previous or 0) + 1


def _answer_rows(
    version: VersionContent,
    response_id: uuid.UUID,
    answers: dict[str, Any],
    scored: Score | None,
) -> list[dict[str, Any]]:
    """response_answers rows: one per selected option for checkboxes, otherwise one per
    answer. Trainings mark the first row of each marked question right or wrong."""
    answer_rows: list[dict[str, Any]] = []
    for key, value in answers.items():
        ref = version.questions[key]
        base: dict[str, Any] = {
            "response_id": response_id,
            "question_id": ref.id,
            "option_id": None,
            "value_num": None,
            "value_text": None,
            "correct": None,
        }
        if ref.type == "multi":
            rows = [{**base, "option_id": ref.option_ids[k]} for k in value]
        elif ref.type in ("single", "dropdown"):
            rows = [{**base, "option_id": ref.option_ids[value]}]
        elif ref.type in ("rating", "money", "number"):
            rows = [{**base, "value_num": Decimal(str(value))}]
        else:
            rows = [{**base, "value_text": value}]
        if scored is not None and key in scored.correct:
            rows[0]["correct"] = scored.correct[key]
        answer_rows.extend(rows)
    return answer_rows


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
    if context.survey.kind == "training":
        progress = await progress_for(session, survey_id, user.employee_id)
        problems = merge_video_problems(
            problems, video_problems(version, visible, answers, progress)
        )
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
    if refusal := _refusal(context, participation, editing=editing):
        await session.rollback()
        raise refusal

    now = datetime.now(UTC)
    anonymous = context.anonymous
    # Anonymous: no employee ID on the response, and times rounded to the hour so they can't
    # be matched to the participation record.
    stamp = _hour(now) if anonymous else now
    member = context.member
    scored = score_attempt(version.scorable(), answers, visible) if context.training else None
    attempt_passed = (
        passed(scored.score, context.quiz_rules.get("pass_mark")) if scored is not None else None
    )

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
        attempt_no = 1 if anonymous else await _next_attempt_no(session, survey_id, user)
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
                attempt_no=attempt_no,
                points=scored.points if scored else None,
                max_points=scored.max_points if scored else None,
                score=scored.score if scored else None,
                passed=attempt_passed,
            )
        )

    answer_rows = _answer_rows(version, response_id, answers, scored)
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
            **(
                _best_attempt(participation, response_id, scored.score, attempt_passed, now)
                if scored is not None
                else {}
            ),
        )
    )
    await session.commit()
    results_cache.invalidate(survey_id)
    context.participation = await session.get(
        SurveyParticipation, (survey_id, user.employee_id), populate_existing=True
    )
    if context.training:
        response = await session.get(SurveyResponse, response_id)
        assert response is not None  # noqa: S101 - inserted above
        return Submitted(
            submitted_at=stamp,
            can_edit=False,
            can_respond_again=context.attempts_left() != 0,
            training=await attempt_result(session, context, response),
        )
    return Submitted(
        submitted_at=stamp,
        can_edit=context.can_edit(open_now=True),
        can_respond_again=not one_response,
    )


def _best_attempt(
    participation: SurveyParticipation,
    response_id: uuid.UUID,
    score: int | None,
    attempt_passed: bool | None,
    now: datetime,
) -> dict[str, Any]:
    """Participation updates for a new training attempt. The best score counts (the earliest
    attempt on a tie); once passed, a person stays passed."""
    best = participation.best_score
    better = participation.best_response_id is None or (
        score is not None and (best is None or score > best)
    )
    if participation.passed or attempt_passed:
        ever_passed: bool | None = True
    elif participation.passed is False or attempt_passed is False:
        ever_passed = False
    else:
        ever_passed = None
    return {
        "attempts": participation.attempts + 1,
        "best_response_id": response_id if better else participation.best_response_id,
        "best_score": score if better else best,
        "passed": ever_passed,
        "passed_at": participation.passed_at or (now if attempt_passed else None),
    }


# --- training results for the person ----------------------------------------------------------


def _shown_answer(question: dict[str, Any], value: Any) -> str | None:
    """An answer as text, in the version's own words (labels, grouped numbers)."""
    if value is None:
        return None
    labels = {o["key"]: o["label"] for o in question["options"]}
    if question["type"] == "multi" and isinstance(value, list):
        return ", ".join(labels.get(k, "") for k in value) or None
    if question["type"] in ("single", "dropdown"):
        return labels.get(value)
    if question["type"] == "number" and isinstance(value, int | float):
        return format_number(value, question["config"].get("number_unit"))
    return str(value)


def _correct_answer(question: dict[str, Any], key: dict[str, Any]) -> str:
    if question["type"] == "number":
        unit = question["config"].get("number_unit")
        low, high = key.get("correct_min"), key.get("correct_max")
        if low is None or high is None:
            return ""
        if low == high:
            return format_number(low, unit)
        return f"{format_number(low)} to {format_number(high, unit)}"
    labels = {o["key"]: o["label"] for o in question["options"]}
    return ", ".join(labels[k] for k in key.get("correct_options") or [] if k in labels)


async def answer_review(session: AsyncSession, response: SurveyResponse) -> list[dict[str, Any]]:
    """Each marked question the person was shown: right or not, their answer and the correct
    one. Built from the attempt's own version, so a later republish doesn't change it."""
    version = await load_version(session, response.version_id)
    answers = await response_answers(session, version, response.id)
    by_id = {ref.id: key for key, ref in version.questions.items()}
    shown = [
        by_id[qid]
        for qid in (
            await session.scalars(
                select(ResponseShown.question_id).where(ResponseShown.response_id == response.id)
            )
        )
        if qid in by_id
    ]
    questions = version.scorable()
    scored = score_attempt(questions, answers, shown)
    review: list[dict[str, Any]] = []
    for question in questions:
        key = question["key"]
        if key not in scored.correct:
            continue
        review.append(
            {
                "question_key": key,
                "text": question["text"],
                "correct": scored.correct[key],
                "points": int(question["quiz"].get("points") or 1),
                "your_answer": _shown_answer(question, answers.get(key)),
                "correct_answer": _correct_answer(question, question["quiz"]),
            }
        )
    return review


async def attempt_result(
    session: AsyncSession, context: RespondentContext, response: SurveyResponse
) -> AttemptResult:
    """A training attempt, with only what the creator lets the person see."""
    rules = context.quiz_rules
    p = context.participation
    left = context.attempts_left()
    show_score = bool(rules.get("show_score", True))
    allowed = show_answers(
        rules.get("show_answers", "after_pass_or_last"), p.passed if p else None, left
    )
    return AttemptResult(
        attempt_no=response.attempt_no,
        score=response.score if show_score else None,
        points=response.points if show_score else None,
        max_points=response.max_points if show_score else None,
        passed=response.passed if show_score else None,
        pass_mark=rules.get("pass_mark") if show_score else None,
        attempts_used=p.attempts if p else 0,
        attempts_left=left,
        review=await answer_review(session, response) if allowed else None,
    )


@dataclass(frozen=True, slots=True)
class TrainingInfo:
    """GET /respond/{id} for a training: the rules as shown before starting, and the latest
    attempt's result."""

    pass_mark: int | None
    retakes: str
    max_attempts: int
    attempts_used: int
    attempts_left: int | None
    last_result: AttemptResult | None


async def training_info(session: AsyncSession, context: RespondentContext) -> TrainingInfo:
    rules = context.quiz_rules
    p = context.participation
    last: AttemptResult | None = None
    if p is not None and p.attempts > 0 and p.response_id is not None:
        response = await session.get(SurveyResponse, p.response_id)
        if response is not None:
            last = await attempt_result(session, context, response)
    return TrainingInfo(
        pass_mark=rules.get("pass_mark") if rules.get("show_pass_mark", True) else None,
        retakes=rules.get("retakes", "none"),
        max_attempts=int(rules.get("max_attempts") or 1),
        attempts_used=p.attempts if p else 0,
        attempts_left=context.attempts_left(),
        last_result=last,
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
    session: AsyncSession,
    settings: Settings,
    user: AuthenticatedUser,
    kind: Literal["survey", "training"] = "survey",
) -> list[dict[str, Any]]:
    """Surveys (or trainings) this person can take now, plus ones they've completed."""
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
            Survey.kind == kind,
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
        video_sections = [s["key"] for s in version.content["sections"] if s.get("video")]
        videos_done = 0
        if video_sections:
            progress = await progress_for(session, survey.id, user.employee_id)
            videos_done = sum(1 for k in video_sections if k in progress and progress[k].completed)
        extra: dict[str, Any] = {}
        if kind == "training":
            rules = version_settings.get("quiz") or {}
            used = participation.attempts if participation else 0
            best = participation.best_score if participation else None
            ever = participation.passed if participation else None
            show_score = bool(rules.get("show_score", True))
            extra = {
                "attempts_used": used,
                "attempts_left": attempts_left(rules, used, best, ever),
                "best_score": best if show_score else None,
                "passed": ever if show_score else None,
            }
        items.append(
            {
                **extra,
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
                "videos_total": len(video_sections),
                "videos_done": videos_done,
            }
        )
    return items
