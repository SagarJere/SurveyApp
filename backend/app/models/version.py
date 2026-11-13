"""Published, read-only versions of a survey (docs/03-data-model.md).

Publishing copies the draft into these normalised tables. Keys stay the same across versions,
so reports can combine versions by question and option key.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SurveyVersion(Base):
    __tablename__ = "survey_versions"
    __table_args__ = (UniqueConstraint("survey_id", "version_no"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE")
    )
    version_no: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB)
    theme: Mapped[dict[str, Any]] = mapped_column(JSONB)
    published_by: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class VersionSection(Base):
    __tablename__ = "survey_sections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sort_order: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    condition: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Trainings: the section's video (docs/03-data-model.md, "Training additions"), or null.
    video: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class VersionQuestion(Base):
    __tablename__ = "survey_questions"
    __table_args__ = (Index(None, "version_id", "sort_order"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="CASCADE")
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_sections.id", ondelete="CASCADE")
    )
    key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sort_order: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    help: Mapped[str] = mapped_column(Text)
    required: Mapped[bool] = mapped_column(Boolean)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    condition: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Trainings: the answer key {points, correct_options} or {points, correct_min, correct_max},
    # or null when not marked. Never sent to respondents until the creator's rule allows.
    quiz: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class QuestionOption(Base):
    __tablename__ = "question_options"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_questions.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sort_order: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(Text)
