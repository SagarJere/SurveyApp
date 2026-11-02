"""Issue and verify the API's own access tokens (HS256 JWTs).

Whatever the login method (dev ID today, SSO later), the API issues this token, and every
other endpoint relies only on it.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast, get_args

import jwt

from app.auth.types import AuthenticatedUser, Role
from app.config import Settings

ALGORITHM = "HS256"
ISSUER = "pulse-api"
AUDIENCE = "pulse"
_ROLES: tuple[str, ...] = get_args(Role)


class TokenError(Exception):
    """Base for token problems. `code` and `message` go straight into the 401 response."""

    code = "INVALID_TOKEN"
    message = "Your sign-in isn't valid. Please sign in again."


class TokenExpiredError(TokenError):
    code = "TOKEN_EXPIRED"
    message = "Your session has expired. Please sign in again."


class InvalidTokenError(TokenError):
    pass


@dataclass(frozen=True, slots=True)
class IssuedToken:
    token: str
    expires_at: datetime


def issue_token(
    user: AuthenticatedUser, settings: Settings, *, now: datetime | None = None
) -> IssuedToken:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.jwt_expires_minutes)
    claims: dict[str, Any] = {
        "sub": user.employee_id,
        "role": user.role,
        "name": user.name,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm=ALGORITHM)
    return IssuedToken(token=token, expires_at=datetime.fromtimestamp(claims["exp"], UTC))


def verify_token(token: str, settings: Settings) -> AuthenticatedUser:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[ALGORITHM],  # never trust the token's own "alg" header
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["sub", "role", "exp", "iat", "iss", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError from exc
    except jwt.PyJWTError as exc:
        raise InvalidTokenError from exc

    subject, role, name = claims.get("sub"), claims.get("role"), claims.get("name")
    if not isinstance(subject, str) or not subject or role not in _ROLES:
        raise InvalidTokenError
    if name is not None and not isinstance(name, str):
        raise InvalidTokenError
    return AuthenticatedUser(employee_id=subject, name=name, role=cast("Role", role))
