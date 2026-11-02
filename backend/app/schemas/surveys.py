from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.draft import Draft
from app.services.survey_logic import ConditionProblem, IssueCode

SurveyStatus = Literal["draft", "published", "closed"]
MemberRole = Literal["owner", "coowner", "viewer"]


class SurveyListItem(BaseModel):
    id: UUID
    title: str
    status: SurveyStatus
    version_no: int | None
    response_count: int
    audience_count: int
    response_rate: float | None
    opens_at: date | None
    closes_at: date | None
    has_unpublished_changes: bool
    my_role: MemberRole | None
    can_edit: bool
    can_delete: bool
    updated_at: datetime


class SurveyDetail(BaseModel):
    id: UUID
    title: str
    status: SurveyStatus
    version_no: int | None
    draft: Draft
    draft_updated_at: datetime
    has_unpublished_changes: bool
    open_to_all: bool
    my_role: MemberRole | None
    can_edit: bool
    can_delete: bool
    created_at: datetime
    updated_at: datetime


class SaveDraftRequest(BaseModel):
    draft: Draft
    draft_updated_at: datetime


class SaveDraftResponse(BaseModel):
    draft_updated_at: datetime


class IssueOut(BaseModel):
    code: IssueCode
    message: str
    question_key: str | None
    section_key: str | None
    problem: ConditionProblem | None


class ValidateResponse(BaseModel):
    issues: list[IssueOut]
