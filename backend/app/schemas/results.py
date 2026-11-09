from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel


class VersionInfo(BaseModel):
    version_no: int
    published_at: datetime
    responses: int


class Headline(BaseModel):
    question_key: str
    text: str
    average: float | None


class MoneyHeadline(BaseModel):
    question_key: str
    text: str
    currency: str
    median: float
    median_formatted: str
    median_words: str


class FilterOptions(BaseModel):
    departments: list[str]
    locations: list[str]


class Summary(BaseModel):
    small_group: bool
    responses: int
    respondents: int
    invited: int | None
    response_rate: float | None
    responses_this_week: int
    last_response_at: datetime | None
    headline: Headline | None
    money: MoneyHeadline | None
    # About the survey and the report
    title: str
    status: Literal["draft", "published", "closed"]
    anonymous: bool
    open_to_all: bool
    versions: list[VersionInfo]
    compatible_versions: bool
    version_applied: int | None
    filter_options: FilterOptions
    can_download_non_responders: bool
    closes_at: date | None


class Day(BaseModel):
    day: date
    n: int


class Timeline(BaseModel):
    days: list[Day]
    reminders: list[date]


class DepartmentRow(BaseModel):
    department: str | None
    invited: int | None
    responded: int
    rate: float | None


class Participation(BaseModel):
    open_to_all: bool
    departments: list[DepartmentRow]


class OptionCount(BaseModel):
    key: str
    label: str
    n: int
    share: float


class RatingCount(BaseModel):
    value: int
    n: int
    share: float


class MoneyStats(BaseModel):
    total: float | None
    average: float | None
    median: float | None
    min: float | None
    max: float | None
    average_words: str | None
    median_words: str | None


class RangeCount(BaseModel):
    label: str
    n: int
    share: float


class QuestionResult(BaseModel):
    key: str
    number: int
    type: str
    text: str
    required: bool
    condition: dict[str, Any] | None
    shown: int
    answered: int
    options: list[OptionCount] | None = None
    average: float | None = None
    distribution: list[RatingCount] | None = None
    currency: str | None = None
    unit: str | None = None
    stats: MoneyStats | None = None
    ranges: list[RangeCount] | None = None


class SectionResult(BaseModel):
    key: str
    title: str
    description: str
    condition: dict[str, Any] | None
    questions: list[QuestionResult]


class QuestionsResult(BaseModel):
    small_group: bool
    responses: int
    sections: list[SectionResult]


class Person(BaseModel):
    employee_id: str
    name: str | None


class Comment(BaseModel):
    question_key: str
    number: int | None
    text: str
    department: str | None
    location: str | None
    submitted_on: date
    employee: Person | None


class Comments(BaseModel):
    small_group: bool
    total: int
    page: int
    page_size: int
    items: list[Comment]


class ResponseRow(BaseModel):
    id: UUID
    employee_id: str | None
    name: str | None
    department: str | None
    location: str | None
    submitted_at: datetime
    version_no: int


class ResponsesPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ResponseRow]


class AnswerRow(BaseModel):
    key: str
    number: int
    type: str
    text: str
    answer: str
    value: Any


class ResponseDetail(ResponseRow):
    answers: list[AnswerRow]
