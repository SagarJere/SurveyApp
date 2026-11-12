"""Survey rules shared with the frontend (frontend/src/features/survey-logic/).

Condition problems, visibility, answer clean-up and publish validation. Both implementations
must pass the same cases in shared/test-cases/*.json. Functions here work on the draft's JSON
shape (docs/03-data-model.md, "Draft JSON shape") so the case files can use readable keys.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from math import isfinite
from typing import Any, Literal, NotRequired, TypedDict

from app.services.money import MAX_AMOUNT
from app.services.numbers import MAX_NUMBER

QuestionType = Literal["single", "multi", "dropdown", "rating", "short", "long", "money", "number"]
ConditionOp = Literal["is", "not", "gte", "lte", "gt", "lt"]
ConditionProblem = Literal[
    "source_missing",  # the question it depended on was deleted
    "source_after",  # the source now comes after this question
    "source_not_earlier_section",  # a section's source is in the same or a later section
    "source_ineligible",  # the source is no longer a choice, rating or money question
    "answer_changed",  # the option was removed, or the operator/value no longer fits
]


@dataclass(frozen=True, slots=True)
class QuestionTypeSpec:
    label: str
    has_options: bool
    condition_ops: tuple[ConditionOp, ...]  # empty: can't be a condition source


# Numeric sources: at least, at most, greater than, less than, equal to, not equal to.
# The first is the default for a new condition.
NUMERIC_OPS: tuple[ConditionOp, ...] = ("gte", "lte", "gt", "lt", "is", "not")

# Backend mirror of the frontend question type registry (docs/02-architecture.md).
QUESTION_TYPES: dict[QuestionType, QuestionTypeSpec] = {
    "single": QuestionTypeSpec("Single choice", has_options=True, condition_ops=("is", "not")),
    "multi": QuestionTypeSpec("Checkboxes", has_options=True, condition_ops=("is", "not")),
    "dropdown": QuestionTypeSpec("Dropdown", has_options=True, condition_ops=("is", "not")),
    "rating": QuestionTypeSpec(
        "Rating 1–5",  # noqa: RUF001 - en dash, as in the docs
        has_options=False,
        condition_ops=NUMERIC_OPS,
    ),
    "short": QuestionTypeSpec("Short answer", has_options=False, condition_ops=()),
    "long": QuestionTypeSpec("Paragraph", has_options=False, condition_ops=()),
    "money": QuestionTypeSpec("Money", has_options=False, condition_ops=NUMERIC_OPS),
    "number": QuestionTypeSpec("Number", has_options=False, condition_ops=NUMERIC_OPS),
}
NUMERIC_TYPES = ("rating", "money", "number")

RATING_VALUES = (1, 2, 3, 4, 5)


class ConditionDict(TypedDict):
    src: str
    op: str
    val: Any


class OptionDict(TypedDict):
    key: str
    label: str


class SectionDict(TypedDict):
    key: str
    title: NotRequired[str]
    condition: NotRequired[ConditionDict | None]


class QuestionDict(TypedDict):
    key: str
    section_key: str
    type: str
    text: NotRequired[str]
    required: NotRequired[bool]
    options: NotRequired[list[OptionDict]]
    config: NotRequired[dict[str, Any]]
    condition: NotRequired[ConditionDict | None]


class SettingsDict(TypedDict, total=False):
    opens_at: str | None
    closes_at: str | None


class DraftDict(TypedDict):
    sections: list[SectionDict]
    questions: list[QuestionDict]
    settings: NotRequired[SettingsDict]


Answers = Mapping[str, Any]


def is_answered(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, list):
        return len(value) > 0
    return True


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and isfinite(value)


def _condition_value_fits(source: QuestionDict, op: str, val: object) -> bool:
    spec = QUESTION_TYPES.get(source["type"])  # type: ignore[call-overload]
    if spec is None or op not in spec.condition_ops:
        return False
    if spec.has_options:
        return isinstance(val, str) and any(o["key"] == val for o in source.get("options", []))
    if source["type"] == "rating":
        return _is_number(val) and val in RATING_VALUES
    if source["type"] == "number":
        return _is_number(val) and abs(float(val)) <= float(MAX_NUMBER)  # type: ignore[arg-type]
    return _is_number(val) and 0 <= float(val) <= float(MAX_AMOUNT)  # type: ignore[arg-type]


def _eligible(question: QuestionDict) -> bool:
    spec = QUESTION_TYPES.get(question["type"])  # type: ignore[call-overload]
    return spec is not None and bool(spec.condition_ops)


@dataclass(slots=True)
class _Index:
    question_pos: dict[str, int]
    section_pos: dict[str, int]
    questions: dict[str, QuestionDict]

    @classmethod
    def of(cls, draft: DraftDict) -> "_Index":
        return cls(
            question_pos={q["key"]: i for i, q in enumerate(draft["questions"])},
            section_pos={s["key"]: i for i, s in enumerate(draft["sections"])},
            questions={q["key"]: q for q in draft["questions"]},
        )


def _problem(
    index: _Index, condition: ConditionDict, *, question_pos: int | None, section_pos: int | None
) -> ConditionProblem | None:
    source = index.questions.get(condition["src"])
    if source is None:
        return "source_missing"
    if question_pos is not None and index.question_pos[source["key"]] >= question_pos:
        return "source_after"
    if section_pos is not None and index.section_pos.get(source["section_key"], -1) >= section_pos:
        return "source_not_earlier_section"
    if not _eligible(source):
        return "source_ineligible"
    if not _condition_value_fits(source, condition["op"], condition["val"]):
        return "answer_changed"
    return None


def question_condition_problem(draft: DraftDict, question_key: str) -> ConditionProblem | None:
    index = _Index.of(draft)
    question = index.questions[question_key]
    condition = question.get("condition")
    if not condition:
        return None
    return _problem(
        index, condition, question_pos=index.question_pos[question_key], section_pos=None
    )


def section_condition_problem(draft: DraftDict, section_key: str) -> ConditionProblem | None:
    index = _Index.of(draft)
    section = next(s for s in draft["sections"] if s["key"] == section_key)
    condition = section.get("condition")
    if not condition:
        return None
    return _problem(index, condition, question_pos=None, section_pos=index.section_pos[section_key])


def _compare(number: float, op: str, val: float) -> bool:
    """Numbers have at most 2 decimals, so equality is compared in hundredths."""
    a, b = round(number * 100), round(val * 100)
    comparisons = {
        "gte": a >= b,
        "lte": a <= b,
        "gt": a > b,
        "lt": a < b,
        "is": a == b,
        "not": a != b,
    }
    return comparisons.get(op, False)


def _matches(source: QuestionDict, condition: ConditionDict, answers: Answers) -> bool:
    answer = answers.get(source["key"])
    if not is_answered(answer):
        return False  # "is not" is also false when the source is unanswered
    op, val = condition["op"], condition["val"]
    if source["type"] in NUMERIC_TYPES:
        number = _number(answer)
        if number is None or not _is_number(val):
            return False
        return _compare(number, op, float(val))
    hit = val in answer if isinstance(answer, list) else answer == val
    return hit if op == "is" else not hit


@dataclass(frozen=True, slots=True)
class Visibility:
    visible_sections: list[str]
    visible_questions: list[str]
    kept_answers: dict[str, Any] = field(default_factory=dict)
    missing_required: list[str] = field(default_factory=list)


def evaluate(draft: DraftDict, answers: Answers) -> Visibility:
    """Which sections and questions are shown, which answers survive, what's still required.

    Evaluated in display order, so a hidden source hides everything that depends on it.
    Broken conditions fail open (the item shows); publishing is blocked separately.
    """
    index = _Index.of(draft)
    visible: set[str] = set()
    kept: dict[str, Any] = {}
    section_shown: dict[str, bool] = {}

    def condition_holds(
        condition: ConditionDict | None, *, question_pos: int | None, section_pos: int | None
    ) -> bool:
        if not condition:
            return True
        if _problem(index, condition, question_pos=question_pos, section_pos=section_pos):
            return True
        source = index.questions[condition["src"]]
        return source["key"] in visible and _matches(source, condition, kept)

    sections = {s["key"]: s for s in draft["sections"]}
    visible_sections: list[str] = []
    visible_questions: list[str] = []
    missing: list[str] = []
    for position, question in enumerate(draft["questions"]):
        section_key = question["section_key"]
        if section_key not in section_shown:
            section = sections[section_key]
            shown = condition_holds(
                section.get("condition"),
                question_pos=None,
                section_pos=index.section_pos[section_key],
            )
            section_shown[section_key] = shown
            if shown:
                visible_sections.append(section_key)
        if not section_shown[section_key]:
            continue
        if not condition_holds(question.get("condition"), question_pos=position, section_pos=None):
            continue
        key = question["key"]
        visible.add(key)
        visible_questions.append(key)
        if key in answers and is_answered(answers[key]):
            kept[key] = answers[key]
        elif question.get("required", False):
            missing.append(key)

    # Sections without questions still count as shown when their condition holds.
    for section in draft["sections"]:
        key = section["key"]
        if key not in section_shown and condition_holds(
            section.get("condition"), question_pos=None, section_pos=index.section_pos[key]
        ):
            visible_sections.append(key)
    visible_sections.sort(key=index.section_pos.__getitem__)

    return Visibility(
        visible_sections=visible_sections,
        visible_questions=visible_questions,
        kept_answers=kept,
        missing_required=missing,
    )


# --- publish validation --------------------------------------------------------------------

IssueCode = Literal[
    "no_questions",
    "question_text_missing",
    "options_too_few",
    "options_empty",
    "options_duplicate",
    "money_range",
    "number_range",
    "condition_broken",
    "dates_order",
    "theme_image_missing",  # server-only checks (need the database), see services/publish.py
    "video_missing",
    "audience_empty",
    "audience_small_anonymous",  # a warning: doesn't block publishing
]


@dataclass(frozen=True, slots=True)
class Issue:
    code: IssueCode
    message: str
    question_key: str | None = None
    section_key: str | None = None
    problem: ConditionProblem | None = None


def _number(value: object) -> float | None:
    return float(value) if _is_number(value) else None  # type: ignore[arg-type]


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _question_issues(index: _Index, position: int, question: QuestionDict) -> list[Issue]:
    n = position + 1
    key = question["key"]
    issues: list[Issue] = []
    if not question.get("text", "").strip():
        issues.append(Issue("question_text_missing", f"Q{n} has no question text.", key))
    spec = QUESTION_TYPES.get(question["type"])  # type: ignore[call-overload]
    if spec is not None and spec.has_options:
        labels = [o["label"].strip() for o in question.get("options", [])]
        if len(labels) < 2:  # noqa: PLR2004 - a choice needs at least two options
            issues.append(Issue("options_too_few", f"Q{n} needs at least two options.", key))
        if any(not label for label in labels):
            issues.append(
                Issue("options_empty", f"Q{n} has an empty option. Fill it in or remove it.", key)
            )
        filled = [label.casefold() for label in labels if label]
        if len(set(filled)) != len(filled):
            issues.append(
                Issue("options_duplicate", f"Q{n} has two options with the same text.", key)
            )
    if question["type"] == "money":
        config = question.get("config", {})
        low, high = _number(config.get("min")), _number(config.get("max"))
        if low is not None and high is not None and low > high:
            issues.append(Issue("money_range", f"Q{n} has a minimum larger than its maximum.", key))
    if question["type"] == "number":
        config = question.get("config", {})
        low, high = _number(config.get("number_min")), _number(config.get("number_max"))
        if low is not None and high is not None and low > high:
            issues.append(
                Issue("number_range", f"Q{n} has a minimum larger than its maximum.", key)
            )
    condition = question.get("condition")
    if condition:
        problem = _problem(index, condition, question_pos=position, section_pos=None)
        if problem:
            issues.append(
                Issue(
                    "condition_broken",
                    f"Q{n} has a condition that needs attention.",
                    key,
                    problem=problem,
                )
            )
    return issues


def validate_draft(draft: DraftDict) -> list[Issue]:
    """Every problem that blocks publishing, in display order. Empty list means publishable."""
    index = _Index.of(draft)
    issues: list[Issue] = []
    for position, question in enumerate(draft["questions"]):
        issues.extend(_question_issues(index, position, question))

    for position, section in enumerate(draft["sections"]):
        condition = section.get("condition")
        if not condition:
            continue
        problem = _problem(index, condition, question_pos=None, section_pos=position)
        if problem:
            issues.append(
                Issue(
                    "condition_broken",
                    f"Section {position + 1} has a condition that needs attention.",
                    section_key=section["key"],
                    problem=problem,
                )
            )

    if not draft["questions"]:
        issues.append(Issue("no_questions", "Add at least one question."))

    settings = draft.get("settings", {})
    opens, closes = _parse_date(settings.get("opens_at")), _parse_date(settings.get("closes_at"))
    if opens and closes and closes <= opens:
        issues.append(Issue("dates_order", "The closing date must be after the opening date."))

    return issues
