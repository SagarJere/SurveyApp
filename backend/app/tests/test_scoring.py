import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest

from app.services.scoring import attempts_left, passed, score_attempt, show_answers

CASES: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/scoring.json").read_text()
)


@pytest.mark.parametrize("case", CASES["score"], ids=lambda c: c["name"])
def test_score_attempt(case: dict[str, Any]) -> None:
    result = score_attempt(CASES["questions"], case["answers"], case["visible"])
    assert asdict(result) == case["expected"]


@pytest.mark.parametrize("case", CASES["passed"], ids=lambda c: c["name"])
def test_passed(case: dict[str, Any]) -> None:
    assert passed(case["score"], case["pass_mark"]) is case["expected"]


@pytest.mark.parametrize("case", CASES["attempts_left"], ids=lambda c: c["name"])
def test_attempts_left(case: dict[str, Any]) -> None:
    left = attempts_left(case["rules"], case["used"], case["best_score"], case["passed"])
    assert left == case["expected"]


@pytest.mark.parametrize("case", CASES["show_answers"], ids=lambda c: c["name"])
def test_show_answers(case: dict[str, Any]) -> None:
    allowed = show_answers(case["show_answers"], case["passed"], case["attempts_left"])
    assert allowed is case["expected"]
