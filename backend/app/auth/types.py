"""Types shared by every part of authentication."""

from dataclasses import dataclass
from typing import Literal

Role = Literal["admin", "hr", "employee"]


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """Who is making the request.

    Built from the JWT. Routers depend on this, never on a login provider.
    """

    employee_id: str
    name: str | None
    role: Role

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def can_manage_surveys(self) -> bool:
        """HR and admins create surveys, upload audiences and see results."""
        return self.role in ("hr", "admin")
