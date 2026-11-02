from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import jwt as pyjwt
import pytest

from app.auth.jwt import (
    ALGORITHM,
    AUDIENCE,
    ISSUER,
    InvalidTokenError,
    TokenExpiredError,
    issue_token,
    verify_token,
)
from app.auth.types import AuthenticatedUser
from app.config import Settings

USER = AuthenticatedUser(employee_id="E1002", name="Vikram Mehta", role="hr")


def _claims(**overrides: object) -> dict[str, object]:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": "E1002",
        "role": "hr",
        "name": "Vikram Mehta",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _sign(settings: Settings, claims: dict[str, object], secret: str | None = None) -> str:
    return pyjwt.encode(
        claims, secret or settings.jwt_secret.get_secret_value(), algorithm=ALGORITHM
    )


def test_round_trip(settings: Settings) -> None:
    issued = issue_token(USER, settings)

    assert verify_token(issued.token, settings) == USER


def test_expiry_follows_settings(settings_factory: Callable[..., Settings]) -> None:
    settings = settings_factory(jwt_expires_minutes=60)
    now = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)

    issued = issue_token(USER, settings, now=now)

    assert issued.expires_at == now + timedelta(minutes=60)


def test_default_lifetime_is_eight_hours(settings: Settings) -> None:
    now = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)

    assert issue_token(USER, settings, now=now).expires_at == now + timedelta(hours=8)


def test_expired_token_is_rejected(settings: Settings) -> None:
    issued = issue_token(USER, settings, now=datetime.now(UTC) - timedelta(hours=9))

    with pytest.raises(TokenExpiredError):
        verify_token(issued.token, settings)


def test_wrong_secret_is_rejected(settings: Settings) -> None:
    token = _sign(settings, _claims(), secret="another-secret-that-is-long-enough-123")

    with pytest.raises(InvalidTokenError):
        verify_token(token, settings)


def test_unsigned_token_is_rejected(settings: Settings) -> None:
    token = pyjwt.encode(_claims(), key=None, algorithm="none")

    with pytest.raises(InvalidTokenError):
        verify_token(token, settings)


def test_tampered_role_is_rejected(settings: Settings) -> None:
    header, payload, signature = issue_token(
        AuthenticatedUser("E2001", None, "employee"), settings
    ).token.split(".")
    forged_payload = pyjwt.utils.base64url_encode(
        pyjwt.utils.base64url_decode(payload).replace(b'"employee"', b'"admin"')
    ).decode()

    with pytest.raises(InvalidTokenError):
        verify_token(f"{header}.{forged_payload}.{signature}", settings)


@pytest.mark.parametrize(
    "overrides",
    [
        {"role": "superuser"},
        {"role": None},
        {"sub": ""},
        {"sub": None},
        {"aud": "someone-else"},
        {"iss": "someone-else"},
        {"name": 42},
    ],
)
def test_invalid_claims_are_rejected(settings: Settings, overrides: dict[str, object]) -> None:
    with pytest.raises(InvalidTokenError):
        verify_token(_sign(settings, _claims(**overrides)), settings)


def test_garbage_is_rejected(settings: Settings) -> None:
    with pytest.raises(InvalidTokenError):
        verify_token("not-a-jwt", settings)
