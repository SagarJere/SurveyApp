from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AssetLinks(BaseModel):
    url: str
    mobile_url: str
    width: int


class Participation(BaseModel):
    status: Literal["not_started", "in_progress", "submitted"]
    answers: dict[str, Any]
    can_edit: bool
    can_respond_again: bool
    # The survey was republished since this draft was saved; answers were kept where possible.
    draft_updated: bool


class RespondentSurvey(BaseModel):
    survey_id: UUID
    version_no: int
    title: str
    description: str
    settings: dict[str, Any]
    theme: dict[str, Any]
    sections: list[dict[str, Any]]
    questions: list[dict[str, Any]]
    assets: dict[str, AssetLinks]
    participation: Participation


class AnswersBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict, max_length=1000)


class DraftSaved(BaseModel):
    saved_at: datetime


class SubmitResult(BaseModel):
    status: Literal["submitted"]
    submitted_at: datetime
    can_edit: bool
    can_respond_again: bool


class MySurvey(BaseModel):
    id: UUID
    title: str
    description: str
    status: Literal["pending", "in_progress", "submitted"]
    open: bool
    closes_at: date | None
    minutes: int
    progress: float | None
    accent: str
    cover: AssetLinks | None
    submitted_at: datetime | None
