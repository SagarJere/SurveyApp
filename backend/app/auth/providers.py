"""Login providers. A provider turns login input into an AuthenticatedUser; the router then
issues the API's own JWT. Switching to SSO replaces only the provider.
"""

from typing import Protocol, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dev_accounts import DEV_NAMES
from app.auth.types import AuthenticatedUser, Role
from app.config import Settings
from app.models import AppUser
from app.schemas.auth import LoginRequest


class AuthProvider(Protocol):
    async def authenticate(self, request: LoginRequest) -> AuthenticatedUser: ...


class DevIdProvider:
    """AUTH_MODE=dev: the employee ID alone signs you in. Role comes from `app_users`."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def authenticate(self, request: LoginRequest) -> AuthenticatedUser:
        employee_id = request.employee_id  # already normalised and validated by the schema
        elevated = await self._session.get(AppUser, employee_id)
        if elevated is not None:
            return AuthenticatedUser(
                employee_id=employee_id, name=elevated.name, role=cast("Role", elevated.role)
            )
        return AuthenticatedUser(
            employee_id=employee_id, name=DEV_NAMES.get(employee_id), role="employee"
        )


def get_auth_provider(settings: Settings, session: AsyncSession) -> AuthProvider:
    if settings.auth_mode == "dev":
        return DevIdProvider(session)
    # Settings validation refuses any other mode until SSO is implemented.
    msg = f"No login provider for AUTH_MODE={settings.auth_mode}"
    raise RuntimeError(msg)
