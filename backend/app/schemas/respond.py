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


class ReviewItem(BaseModel):
    """A marked question in the answer review, in the attempt's own words."""

    question_key: str
    text: str
    correct: bool
    points: int
    your_answer: str | None
    correct_answer: str


class AttemptResult(BaseModel):
    """A training attempt. Score fields are null when the creator hides the score; `review`
    is null unless the creator's rule allows showing the correct answers now."""

    attempt_no: int
    score: int | None
    points: int | None
    max_points: int | None
    passed: bool | None
    pass_mark: int | None
    attempts_used: int
    attempts_left: int | None  # null = no limit
    review: list[ReviewItem] | None


class TrainingInfo(BaseModel):
    pass_mark: int | None  # null when there's none, or the creator doesn't show it up front
    retakes: Literal["none", "limit", "until_pass", "until_perfect"]
    max_attempts: int
    attempts_used: int
    attempts_left: int | None
    last_result: AttemptResult | None


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
    # Trainings: the quiz rules as shown before starting, attempts, and the latest result.
    # Never includes an answer key.
    training: TrainingInfo | None = None
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
    training: AttemptResult | None = None


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
    # Trainings: attempts, and the best score and pass (null when the score is hidden).
    attempts_used: int = 0
    attempts_left: int | None = None
    best_score: int | None = None
    passed: bool | None = None
