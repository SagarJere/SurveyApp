from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class RowToFix(BaseModel):
    row: int
    employee_id: str
    problem: str


class UploadPreview(BaseModel):
    upload_id: UUID
    file_name: str
    mode: Literal["append", "replace"]
    status: Literal["preview", "applied", "discarded"]
    valid_count: int
    duplicate_count: int
    error_count: int
    errors: list[RowToFix]
    errors_truncated: bool


class ApplyResult(BaseModel):
    audience_count: int


class AudienceMember(BaseModel):
    employee_id: str
    name: str | None
    email: str | None
    department: str | None
    location: str | None
    added_at: datetime
    responded: bool


class DepartmentCount(BaseModel):
    department: str | None
    count: int


class AudienceList(BaseModel):
    open_to_all: bool
    total: int
    matching: int
    page: int
    page_size: int
    items: list[AudienceMember]
    departments: list[DepartmentCount]
    can_replace: bool


class OpenToAll(BaseModel):
    open_to_all: bool
