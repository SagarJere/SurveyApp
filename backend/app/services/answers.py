"""Checking respondent answers against a published version.

Mirrors frontend/src/features/survey-logic/answers.ts (money and number range wording) and the input
limits of the respondent form. The server is the authority: anything the browser sends is
checked again here.
"""

from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from math import isfinite
from typing import Any

from app.services.money import MAX_AMOUNT, Currency, format_amount
from app.services.numbers import MAX_NUMBER, number_range_error
from app.services.version_content import QuestionRef

TEXT_LIMITS = {"short": 2000, "long": 10_000}
REQUIRED_MESSAGE = "This question is required."


class _Invalid:
    def __init__(self, message: str) -> None:
        self.message = message


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if isfinite(value) else None


def _choice(question: QuestionRef, value: Any) -> Any:
    if isinstance(value, str) and value in question.option_ids:
        return value
    return _Invalid("Choose one of the options.")


def _checkboxes(question: QuestionRef, value: Any) -> Any:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        return _Invalid("Choose from the options.")
    chosen = set(value)
    if not chosen <= question.option_ids.keys():
        return _Invalid("Choose from the options.")
    return [key for key in question.option_ids if key in chosen]  # display order, no repeats


def _rating(_: QuestionRef, value: Any) -> Any:
    number = _number(value)
    if number is None or not number.is_integer() or not 1 <= number <= 5:  # noqa: PLR2004
        return _Invalid("Choose a rating from 1 to 5.")
    return int(number)


def _money(question: QuestionRef, value: Any) -> Any:
    number = _number(value)
    if number is None or number < 0 or number > float(MAX_AMOUNT):
        return _Invalid("Enter an amount.")
    if not question.config.get("decimals") and not number.is_integer():
        return _Invalid("Enter a whole amount, without paise or cents.")
    return float(Decimal(str(number)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _number_answer(question: QuestionRef, value: Any) -> Any:
    number = _number(value)
    if number is None or abs(number) > float(MAX_NUMBER):
        return _Invalid("Enter a number.")
    if not question.config.get("number_decimals") and not number.is_integer():
        return _Invalid("Enter a whole number.")
    rounded = float(Decimal(str(number)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return int(rounded) if rounded.is_integer() else rounded


def _text(question: QuestionRef, value: Any) -> Any:
    if not isinstance(value, str):
        return _Invalid("Enter text.")
    text = value.strip()
    limit = TEXT_LIMITS[question.type]
    if len(text) > limit:
        return _Invalid(f"Keep this under {limit:,} characters.")
    return text or None


_CLEANERS: dict[str, Callable[[QuestionRef, Any], Any]] = {
    "single": _choice,
    "dropdown": _choice,
    "multi": _checkboxes,
    "rating": _rating,
    "money": _money,
    "number": _number_answer,
    "short": _text,
    "long": _text,
}


def clean_value(question: QuestionRef, value: Any) -> Any:
    """Normalise one answer. Returns None for "unanswered", or _Invalid with a message."""
    if value is None or (isinstance(value, str | list) and len(value) == 0):
        return None
    cleaner = _CLEANERS.get(question.type)
    if cleaner is None:
        return _Invalid("This question can't be answered.")
    return cleaner(question, value)


def is_invalid(value: Any) -> bool:
    return isinstance(value, _Invalid)


def invalid_message(value: Any) -> str:
    return value.message if isinstance(value, _Invalid) else ""


def range_error(question: QuestionRef, value: Any) -> str | None:
    """Money or number outside the question's limits, worded as on the respondent form:
    "Enter ₹5,00,000 or less." / "Enter a number from 1 to 10."."""
    if not isinstance(value, float | int) or isinstance(value, bool):
        return None
    if question.type == "number":
        return number_range_error(question.config, float(value))
    if question.type != "money":
        return None
    currency: Currency = question.config.get("currency", "INR")
    low, high = question.config.get("min"), question.config.get("max")
    if isinstance(low, int | float) and value < low:
        return f"Enter at least {format_amount(low, currency)}."
    if isinstance(high, int | float) and value > high:
        return f"Enter {format_amount(high, currency)} or less."
    return None


def clean_draft(questions: dict[str, QuestionRef], answers: dict[str, Any]) -> dict[str, Any]:
    """Keep what fits the version: known questions, right types. Ranges aren't enforced in
    drafts, so a half-typed amount isn't lost."""
    kept: dict[str, Any] = {}
    for key, value in answers.items():
        question = questions.get(key)
        if question is None:
            continue
        cleaned = clean_value(question, value)
        if cleaned is not None and not is_invalid(cleaned):
            kept[key] = cleaned
    return kept
