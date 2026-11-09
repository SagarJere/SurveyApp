"""Participation and responses (docs/03-data-model.md).

Participation is kept apart from answers: anonymous responses carry no employee ID, yet the
participation row still stops anyone answering twice.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SurveyResponse(Base):
    __tablename__ = "survey_responses"
    __table_args__ = (
        Index("ix_survey_responses_survey_id_submitted_at", "survey_id", "submitted_at"),
        Index("ix_survey_responses_version_id", "version_id"),
        Index("ix_survey_responses_survey_id_department", "survey_id", "department"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE")
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="CASCADE")
    )
    employee_id: Mapped[str | None] = mapped_column(Text)  # null when anonymous
    # The respondent's name at submit time, from sign-in. Null when anonymous. Reports prefer
    # the name on the survey's audience list, so this matters for "open to all" surveys.
    name: Mapped[str | None] = mapped_column(Text)
    department: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveyParticipation(Base):
    __tablename__ = "survey_participation"
    __table_args__ = (
        CheckConstraint("status IN ('in_progress', 'submitted')", name="status_valid"),
        Index("ix_survey_participation_employee_id_status", "employee_id", "status"),
    )

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True
    )
    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text)
    draft_answers: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    draft_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    response_id: Mapped[uuid.UUID | None] = mapped_column(  # null for anonymous surveys
        UUID(as_uuid=True), ForeignKey("survey_responses.id", ondelete="SET NULL")
    )


class ResponseAnswer(Base):
    __tablename__ = "response_answers"
    __table_args__ = (
        Index("ix_response_answers_question_id_option_id", "question_id", "option_id"),
        Index("ix_response_answers_response_id", "response_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    response_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_responses.id", ondelete="CASCADE")
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_questions.id", ondelete="CASCADE")
    )
    option_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("question_options.id", ondelete="CASCADE")
    )
    value_num: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    value_text: Mapped[str | None] = mapped_column(Text)


class ResponseShown(Base):
    """Which questions each response was shown: the denominator for every percentage."""

    __tablename__ = "response_shown"

    response_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_responses.id", ondelete="CASCADE"), primary_key=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("survey_questions.id", ondelete="CASCADE"), primary_key=True
    )
