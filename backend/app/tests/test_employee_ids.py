import pytest

from app.services.employee_ids import (
    InvalidEmployeeIdError,
    normalize_employee_id,
    parse_employee_id,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" e123 ", "E123"),
        ("E123", "E123"),
        ("\te0042\n", "E0042"),  # leading zeros are kept
        ("ab-12_x.y", "AB-12_X.Y"),  # no format rule beyond spaces and length
        ("x" * 30, "X" * 30),
    ],
)
def test_valid_ids_are_normalised(raw: str, expected: str) -> None:
    assert parse_employee_id(raw) == expected
    assert normalize_employee_id(raw) == expected


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "Enter your employee ID."),
        ("   ", "Enter your employee ID."),
        ("E 123", "can't contain spaces"),
        ("E\u00a0123", "can't contain spaces"),
        ("x" * 31, "longer than 30"),
    ],
)
def test_invalid_ids_are_rejected(raw: str, message: str) -> None:
    with pytest.raises(InvalidEmployeeIdError, match=message):
        parse_employee_id(raw)
