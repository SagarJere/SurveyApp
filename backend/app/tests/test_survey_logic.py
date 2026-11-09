import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, get_args

import pytest

from app.services.survey_logic import (
    QUESTION_TYPES,
    QuestionType,
    evaluate,
    is_answered,
    question_condition_problem,
    section_condition_problem,
    validate_draft,
)

CASES: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/survey-logic.json").read_text()
)


@pytest.mark.parametrize("case", CASES["visibility"], ids=lambda c: c["name"])
def test_visibility_cases(case: dict[str, Any]) -> None:
    result = evaluate(case["survey"], case["answers"])

    assert result.visible_sections == case["visible_sections"]
    assert result.visible_questions == case["visible_questions"]
    assert result.kept_answers == case["kept_answers"]
    assert result.missing_required == case["missing_required"]


@pytest.mark.parametrize("case", CASES["problems"], ids=lambda c: c["name"])
def test_condition_problem_cases(case: dict[str, Any]) -> None:
    check = question_condition_problem if case["kind"] == "question" else section_condition_problem

    assert check(case["survey"], case["key"]) == case["problem"]


@pytest.mark.parametrize("case", CASES["validation"], ids=lambda c: c["name"])
def test_validation_cases(case: dict[str, Any]) -> None:
    assert [asdict(issue) for issue in validate_draft(case["survey"])] == case["issues"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, False), ("", False), ("  ", False), ([], False), (0, True), ("a", True), (["x"], True)],
)
def test_is_answered(value: object, expected: bool) -> None:
    assert is_answered(value) is expected


def test_registry_covers_all_eight_types() -> None:
    assert set(QUESTION_TYPES) == {
        "single",
        "multi",
        "dropdown",
        "rating",
        "short",
        "long",
        "money",
        "number",
    }
    assert set(get_args(QuestionType)) == set(QUESTION_TYPES)
    assert [t for t, spec in QUESTION_TYPES.items() if not spec.condition_ops] == ["short", "long"]
