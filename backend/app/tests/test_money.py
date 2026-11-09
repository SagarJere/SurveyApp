import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from app.services.money import Currency, amount_in_words, format_amount, group_digits

CASES: list[dict[str, Any]] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/money.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['currency']}-{c['amount']}")
def test_shared_money_cases(case: dict[str, Any]) -> None:
    currency: Currency = case["currency"]
    amount = Decimal(case["amount"])

    assert format_amount(amount, currency) == case["formatted"]
    assert amount_in_words(amount, currency) == case["words"]


def test_floats_are_rounded_to_paise() -> None:
    assert format_amount(1234.567, "INR") == "₹1,234.57"
    assert amount_in_words(0.005, "INR") == "Zero rupees and one paisa only"


@pytest.mark.parametrize("value", [Decimal("-1"), Decimal("1000000000000")])
def test_out_of_range_amounts_are_rejected(value: Decimal) -> None:
    with pytest.raises(ValueError, match=r"negative|12 digits"):
        format_amount(value, "INR")


@pytest.mark.parametrize(
    ("digits", "indian", "expected"),
    [
        ("1", True, "1"),
        ("999", True, "999"),
        ("1000", True, "1,000"),
        ("100000", True, "1,00,000"),
        ("1234567", False, "1,234,567"),
        ("123", False, "123"),
    ],
)
def test_group_digits(digits: str, indian: bool, expected: str) -> None:
    assert group_digits(digits, indian=indian) == expected
