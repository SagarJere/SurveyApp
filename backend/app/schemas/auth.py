from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.auth.types import AuthenticatedUser, Role
from app.services.employee_ids import parse_employee_id


class LoginRequest(BaseModel):
    """Dev-mode login body. The ID is normalised (trim, uppercase) before anything else."""

    employee_id: str = Field(max_length=200, examples=["E1002"])

    @field_validator("employee_id")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return parse_employee_id(value)


class UserOut(BaseModel):
    employee_id: str
    name: str | None
    role: Role

    @classmethod
    def from_user(cls, user: AuthenticatedUser) -> "UserOut":
        return cls(employee_id=user.employee_id, name=user.name, role=user.role)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_at: datetime
    user: UserOut
