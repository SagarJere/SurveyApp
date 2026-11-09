import json
from pathlib import Path
from typing import Any

import pytest

from app.services.numbers import format_number, number_range_error

CASES: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/number.json").read_text()
)


@pytest.mark.parametrize("case", CASES["format"], ids=lambda c: f"{c['value']} {c.get('unit', '')}")
def test_format_number(case: dict[str, Any]) -> None:
    assert format_number(case["value"], case.get("unit")) == case["expected"]


@pytest.mark.parametrize("case", CASES["range_errors"], ids=lambda c: c["name"])
def test_number_range_error(case: dict[str, Any]) -> None:
    assert number_range_error(case["config"], case["value"]) == case["expected"]
