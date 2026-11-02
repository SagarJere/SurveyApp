"""Surveys and their members. See docs/03-data-model.md."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Survey(Base):
    __tablename__ = "surveys"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'published', 'closed')", name="status_valid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    title: Mapped[str] = mapped_column(Text, server_default="")
    status: Mapped[str] = mapped_column(Text, server_default="draft")
    draft: Mapped[dict[str, Any]] = mapped_column(JSONB)
    draft_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Becomes a foreign key to survey_versions when publishing arrives (Phase 3).
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    has_unpublished_changes: Mapped[bool] = mapped_column(Boolean, server_default="false")
    open_to_all: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SurveyMember(Base):
    __tablename__ = "survey_members"
    __table_args__ = (CheckConstraint("role IN ('owner', 'coowner', 'viewer')", name="role_valid"),)

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True
    )
    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    role: Mapped[str] = mapped_column(Text)
