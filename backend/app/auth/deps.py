"""FastAPI dependencies for authentication and role checks.

Every router uses `CurrentUser` (or `require_role`), never a provider directly.
"""

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import TokenError, verify_token
from app.auth.types import AuthenticatedUser, Role
from app.config import Settings
from app.errors import AppError

_bearer = HTTPBearer(auto_error=False, description="Access token from POST /api/auth/login")
_CHALLENGE = {"WWW-Authenticate": "Bearer"}


def _unauthorized(code: str, message: str) -> AppError:
    return AppError(
        status_code=status.HTTP_401_UNAUTHORIZED, code=code, message=message, headers=_CHALLENGE
    )


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("UNAUTHORIZED", "Please sign in to continue.")
    settings: Settings = request.app.state.settings
    try:
        return verify_token(credentials.credentials, settings)
    except TokenError as exc:
        raise _unauthorized(exc.code, exc.message) from exc


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]


def require_role(*roles: Role) -> Callable[[AuthenticatedUser], Awaitable[AuthenticatedUser]]:
    """Dependency factory: allow only the given roles. Use `require_hr` / `require_admin`."""
    if not roles:
        msg = "require_role needs at least one role"
        raise ValueError(msg)
    allowed = frozenset(roles)

    async def dependency(user: CurrentUser) -> AuthenticatedUser:
        if user.role not in allowed:
            raise AppError(
                status_code=status.HTTP_403_FORBIDDEN,
                message="You don't have access to this.",
            )
        return user

    return dependency


# Admins can do everything HR can (docs/01-requirements.md, Roles).
require_hr = require_role("hr", "admin")
require_admin = require_role("admin")

HrUser = Annotated[AuthenticatedUser, Depends(require_hr)]
AdminUser = Annotated[AuthenticatedUser, Depends(require_admin)]
