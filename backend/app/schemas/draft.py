"""The builder's draft document (surveys.draft). See docs/03-data-model.md, "Draft JSON shape".

Every save is checked here for structure: types, limits, unique keys, and questions grouped by
section in section order. A draft may still be incomplete or have broken conditions; those are
publish problems, reported by services.survey_logic.validate_draft.
"""

import re
from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.money import MAX_AMOUNT, Currency

ACCENT_COLOURS = ("#0E7A6A", "#2457A6", "#6447C2", "#B42F5B", "#9A5B00", "#3A7D2C")
BACKGROUND_COLOURS = ("#E8EEF3", "#F2ECE3", "#E4EFEA", "#ECE7F6", "#1E2833", "#13302C")
DEFAULT_ACCENT = ACCENT_COLOURS[0]

MAX_SECTIONS = 50
MAX_QUESTIONS = 300
MAX_OPTIONS = 100

_ASSET_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

Text = Annotated[str, Field(max_length=2000)]
ShortText = Annotated[str, Field(max_length=300)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class Condition(_Model):
    """Show the item only when an earlier answer matches. `val` is an option key or a number."""

    src: UUID
    op: Literal["is", "not", "gte", "lte"]
    val: UUID | float | None

    @field_validator("val", mode="before")
    @classmethod
    def _reject_booleans(cls, value: Any) -> Any:
        if isinstance(value, bool):
            msg = "Condition value must be an option or a number"
            raise ValueError(msg)
        return value


class Option(_Model):
    key: UUID
    label: ShortText


class MoneyConfig(_Model):
    currency: Currency = "INR"
    min: Annotated[float, Field(ge=0, le=float(MAX_AMOUNT))] | None = None
    max: Annotated[float, Field(ge=0, le=float(MAX_AMOUNT))] | None = None
    decimals: bool = False


QuestionType = Literal["single", "multi", "dropdown", "rating", "short", "long", "money"]


class Question(_Model):
    key: UUID
    section_key: UUID
    type: QuestionType
    text: Annotated[str, Field(max_length=1000)] = ""
    help: Annotated[str, Field(max_length=500)] = ""
    required: bool = False
    # Options are kept when the type changes away from a choice type, so changing back
    # restores them. Only choice types use them.
    options: Annotated[list[Option], Field(max_length=MAX_OPTIONS)] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    condition: Condition | None = None

    @model_validator(mode="after")
    def _check_config(self) -> "Question":
        if self.type == "money":
            self.config = MoneyConfig.model_validate(self.config).model_dump()
        elif len(repr(self.config)) > 1000:  # noqa: PLR2004 - leftover settings stay small
            msg = "Question settings are too large"
            raise ValueError(msg)
        return self


class Section(_Model):
    key: UUID
    title: ShortText = ""
    description: Text = ""
    condition: Condition | None = None


class Settings(_Model):
    layout: Literal["all", "section", "step"] = "step"
    show_navigator: bool = True
    auto_next: bool = False
    one_response: bool = True
    allow_edit: bool = False
    anonymous: bool = False
    opens_at: date | None = None
    closes_at: date | None = None


class Theme(_Model):
    cover: Annotated[str, Field(pattern=_ASSET_ID.pattern)] | None = None
    background_style: Literal["none", "color", "image"] = "none"
    background: Annotated[str, Field(pattern=_ASSET_ID.pattern)] | None = None
    background_color: str = BACKGROUND_COLOURS[0]
    blur: bool = True
    overlay: Annotated[int, Field(ge=0, le=60, multiple_of=5)] = 25
    accent: str = DEFAULT_ACCENT

    @field_validator("accent")
    @classmethod
    def _accent_from_palette(cls, value: str) -> str:
        upper = value.upper()
        if upper not in ACCENT_COLOURS:
            msg = "Accent colour must be one of the brand colours"
            raise ValueError(msg)
        return upper

    @field_validator("background_color")
    @classmethod
    def _background_from_palette(cls, value: str) -> str:
        upper = value.upper()
        if upper not in BACKGROUND_COLOURS:
            msg = "Background colour must be one of the palette colours"
            raise ValueError(msg)
        return upper


class Draft(_Model):
    title: ShortText = ""
    description: Text = ""
    settings: Settings = Field(default_factory=Settings)
    theme: Theme = Field(default_factory=Theme)
    sections: Annotated[list[Section], Field(min_length=1, max_length=MAX_SECTIONS)]
    questions: Annotated[list[Question], Field(max_length=MAX_QUESTIONS)] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def _check_structure(self) -> "Draft":
        keys: list[UUID] = [s.key for s in self.sections]
        for question in self.questions:
            keys.append(question.key)
            keys.extend(o.key for o in question.options)
        if len(set(keys)) != len(keys):
            msg = "Every section, question and option needs its own key"
            raise ValueError(msg)

        order = {section.key: position for position, section in enumerate(self.sections)}
        last = -1
        for question in self.questions:
            position = order.get(question.section_key)
            if position is None:
                msg = f"Question {question.key} belongs to a section that doesn't exist"
                raise ValueError(msg)
            if position < last:
                msg = "Questions must be grouped by section, in section order"
                raise ValueError(msg)
            last = position
        return self

    def as_logic_dict(self) -> Any:
        """The JSON shape used by services.survey_logic and stored in surveys.draft."""
        return self.model_dump(mode="json")
