from uuid import UUID

from pydantic import BaseModel


class VideoOut(BaseModel):
    id: UUID
    file_name: str
    content_type: str
    size_bytes: int
    duration_seconds: int | None
    #: Signed link that plays without a token, for about a day.
    url: str
    #: True while a published version uses it (then it can't be deleted).
    published: bool


class VideoProgressIn(BaseModel):
    furthest_seconds: int
    completed: bool = False


class VideoProgressOut(BaseModel):
    furthest_seconds: int
    completed: bool
