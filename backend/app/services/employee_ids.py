"""The one rule for employee IDs, used by login, audience uploads and SSO alike.

Normalise: trim surrounding spaces and uppercase. Leading zeros are kept as typed.
Invalid: empty, a space inside, or longer than 30 characters. There is no other format rule.
"""

MAX_EMPLOYEE_ID_LENGTH = 30


class InvalidEmployeeIdError(ValueError):
    """Raised with a message that can be shown to the person as is."""


def normalize_employee_id(raw: str) -> str:
    return raw.strip().upper()


def parse_employee_id(raw: str) -> str:
    """Normalise and validate. Returns the normalised ID or raises InvalidEmployeeIdError."""
    value = normalize_employee_id(raw)
    if not value:
        msg = "Enter your employee ID."
        raise InvalidEmployeeIdError(msg)
    if any(char.isspace() for char in value):
        msg = "Employee IDs can't contain spaces."
        raise InvalidEmployeeIdError(msg)
    if len(value) > MAX_EMPLOYEE_ID_LENGTH:
        msg = f"Employee IDs can't be longer than {MAX_EMPLOYEE_ID_LENGTH} characters."
        raise InvalidEmployeeIdError(msg)
    return value
