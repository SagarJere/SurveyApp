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


class SectionVideo(BaseModel):
    """A training section's video, ready to play (an uploaded file's link is signed)."""

    url: str
    allow_seek: bool
    allow_speed: bool
    duration_seconds: int | None


class VideoProgress(BaseModel):
    furthest_seconds: int
    completed: bool


class RespondentSurvey(BaseModel):
    survey_id: UUID
    kind: Literal["survey", "training"]
    version_no: int
    title: str
    description: str
    settings: dict[str, Any]
    theme: dict[str, Any]
    sections: list[dict[str, Any]]
    questions: list[dict[str, Any]]
    assets: dict[str, AssetLinks]
    # Trainings: section key -> its video, and how far this person got in each.
    videos: dict[str, SectionVideo] = Field(default_factory=dict)
    video_progress: dict[str, VideoProgress] = Field(default_factory=dict)
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
    # Trainings: how many of its section videos this person has finished.
    videos_total: int = 0
    videos_done: int = 0
