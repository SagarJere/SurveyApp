"""Number questions: limits, display and range checks. Mirrors
frontend/src/features/survey-logic/numbers.ts; both pass shared/test-cases/number.json.

Answers are stored in response_answers.value_num (numeric(14,2)), so a number has at most
12 digits before the decimal point and 2 after.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.services.money import group_digits

MAX_NUMBER = Decimal("999999999999.99")
MAX_UNIT_LENGTH = 30


def format_number(value: float | int, unit: str | None = None) -> str:
    """12,34,567 · 2.5 · -1,234.75 · "3 people". Up to 2 decimals, trailing zeros dropped."""
    rounded = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if rounded < 0 else ""
    whole, _, fraction = f"{abs(rounded):.2f}".partition(".")
    fraction = fraction.rstrip("0")
    text = f"{sign}{group_digits(whole, indian=True)}" + (f".{fraction}" if fraction else "")
    unit = (unit or "").strip()
    return f"{text} {unit}" if unit else text


def _limit(config: dict[str, Any], key: str) -> float | None:
    value = config.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def number_range_error(config: dict[str, Any], value: float) -> str | None:
    """Same wording as the respondent form: "Enter a number from 1 to 10."."""
    low, high = _limit(config, "number_min"), _limit(config, "number_max")
    if (low is None or value >= low) and (high is None or value <= high):
        return None
    if low is not None and high is not None:
        return f"Enter a number from {format_number(low)} to {format_number(high)}."
    if low is not None:
        return f"Enter at least {format_number(low)}."
    return f"Enter {format_number(high or 0)} or less."
