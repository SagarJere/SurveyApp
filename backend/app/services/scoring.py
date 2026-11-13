"""Training quiz rules (docs/09-trainings.md, "Quiz and scoring").

Shared with frontend/src/features/quiz/scoring.ts: both pass shared/test-cases/scoring.json.
The server is the authority: it scores every attempt at submit, and the answer key never
reaches the respondent's browser before the creator's rule allows.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from math import isfinite
from typing import Any, Literal

Retakes = Literal["none", "limit", "until_pass", "until_perfect"]
ShowAnswers = Literal["after_pass_or_last", "always", "never"]

# Question types HR can mark with a correct answer. Others collect feedback only.
MARKABLE_TYPES = frozenset({"single", "dropdown", "multi", "number"})
PERFECT = 100


def quiz_key(question: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The question's answer key, or None when it isn't marked (or its type can't be)."""
    quiz = question.get("quiz")
    if not isinstance(quiz, Mapping) or question.get("type") not in MARKABLE_TYPES:
        return None
    return quiz


def _hundredths(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not isfinite(value):
        return None
    return round(value * 100)


def is_correct(question: Mapping[str, Any], key: Mapping[str, Any], answer: object) -> bool:
    """Choice: the right option. Checkboxes: exactly the right boxes, no part marks.
    Number: inside the accepted range (an exact value is min = max), limits included."""
    kind = question["type"]
    correct = set(key.get("correct_options") or [])
    if kind in ("single", "dropdown"):
        return isinstance(answer, str) and answer in correct
    if kind == "multi":
        return isinstance(answer, list) and bool(answer) and set(answer) == correct
    value = _hundredths(answer)
    if value is None:
        return False
    low, high = _hundredths(key.get("correct_min")), _hundredths(key.get("correct_max"))
    return (low is None or value >= low) and (high is None or value <= high)


def whole_percent(points: int, max_points: int) -> int | None:
    """points / max_points as a whole %, halves rounded up (12.5 -> 13)."""
    if max_points <= 0:
        return None
    return (200 * points + max_points) // (2 * max_points)


@dataclass(frozen=True, slots=True)
class Score:
    points: int
    max_points: int
    score: int | None  # None when nothing marked was shown
    correct: dict[str, bool] = field(default_factory=dict)  # marked, shown questions only


def score_attempt(
    questions: Iterable[Mapping[str, Any]], answers: Mapping[str, Any], visible: Iterable[str]
) -> Score:
    """Points earned and available to this person. Hidden questions don't count."""
    shown = set(visible)
    points = max_points = 0
    correct: dict[str, bool] = {}
    for question in questions:
        key = quiz_key(question)
        if key is None or question["key"] not in shown:
            continue
        worth = int(key.get("points") or 1)
        right = is_correct(question, key, answers.get(question["key"]))
        correct[question["key"]] = right
        max_points += worth
        points += worth if right else 0
    return Score(points, max_points, whole_percent(points, max_points), correct)


def passed(score: int | None, pass_mark: int | None) -> bool | None:
    """Against the pass mark; None when there's no pass mark or nothing to score."""
    if score is None or pass_mark is None:
        return None
    return score >= pass_mark


def attempts_left(
    rules: Mapping[str, Any], used: int, best_score: int | None, has_passed: bool | None
) -> int | None:
    """Attempts still allowed; None means no limit.

    Passing ends the attempts (except "until perfect", which goes on to 100%), a perfect
    score always ends them, and a training with nothing to score needs only one attempt.
    """
    retakes: Retakes = rules.get("retakes", "none")
    if used > 0 and (best_score is None or best_score >= PERFECT):
        return 0
    if retakes == "until_perfect":
        return None
    if used > 0 and has_passed:
        return 0
    if retakes == "until_pass":
        return None
    total = int(rules.get("max_attempts") or 1) if retakes == "limit" else 1
    return max(0, total - used)


def show_answers(rule: ShowAnswers, has_passed: bool | None, left: int | None) -> bool:
    """Whether the correct answers may be shown now (the creator's rule)."""
    if rule == "always":
        return True
    if rule == "never":
        return False
    return bool(has_passed) or left == 0


# --- publish checks ----------------------------------------------------------------------------


def published_key(question: Mapping[str, Any]) -> dict[str, Any] | None:
    """The answer key as stored on a published question: only what its type uses."""
    key = quiz_key(question)
    if key is None:
        return None
    points = int(key.get("points") or 1)
    if question["type"] == "number":
        return {
            "points": points,
            "correct_min": key.get("correct_min"),
            "correct_max": key.get("correct_max"),
        }
    options = [o["key"] for o in question.get("options") or []]
    chosen = set(key.get("correct_options") or [])
    return {"points": points, "correct_options": [k for k in options if k in chosen]}


def _number_key_problem(question: Mapping[str, Any], key: Mapping[str, Any]) -> str | None:
    low, high = key.get("correct_min"), key.get("correct_max")
    if low is None or high is None:
        return "enter its correct answer (a number, or a range)."
    if low > high:
        return "the lowest correct answer is above the highest."
    config = question.get("config") or {}
    limit_low, limit_high = config.get("number_min"), config.get("number_max")
    if (limit_low is not None and low < limit_low) or (
        limit_high is not None and high > limit_high
    ):
        return "its correct answer is outside the numbers people can enter."
    return None


def _key_problem(question: Mapping[str, Any], key: Mapping[str, Any]) -> str | None:
    if question["type"] == "number":
        return _number_key_problem(question, key)
    options = {o["key"] for o in question.get("options") or []}
    chosen = [k for k in key.get("correct_options") or [] if k in options]
    if not chosen:
        return "tick its correct answer, or turn marking off."
    if question["type"] in ("single", "dropdown") and len(chosen) > 1:
        return "tick only one correct answer."
    return None


def quiz_problems(draft: Mapping[str, Any]) -> list[tuple[str | None, str]]:
    """(question key or None for the quiz settings, message) for a training's draft."""
    problems: list[tuple[str | None, str]] = []
    for number, question in enumerate(draft["questions"], start=1):
        key = quiz_key(question)
        if key is not None and (problem := _key_problem(question, key)):
            problems.append((question["key"], f"Q{number}: {problem}"))
    rules = draft["settings"].get("quiz") or {}
    if rules.get("retakes") == "until_pass" and rules.get("pass_mark") is None:
        problems.append(
            (None, 'Set a pass mark, or choose another retake rule than "until they pass".')
        )
    return problems


def has_marked_questions(draft: Mapping[str, Any]) -> bool:
    return any(quiz_key(q) is not None for q in draft["questions"])
