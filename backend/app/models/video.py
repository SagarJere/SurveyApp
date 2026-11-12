"""Training videos (docs/09-trainings.md): uploaded files, and who finished which video."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VideoAsset(Base):
    """An uploaded training video. Linked videos (internal server) have no row."""

    __tablename__ = "video_assets"
    __table_args__ = (
        CheckConstraint("content_type IN ('video/mp4', 'video/webm')", name="content_type_valid"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), index=True
    )
    file_name: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VideoView(Base):
    """How far someone got in a section's video, and whether they finished it."""

    __tablename__ = "video_views"
    __table_args__ = (CheckConstraint("furthest_seconds >= 0", name="furthest_not_negative"),)

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True
    )
    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    section_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    furthest_seconds: Mapped[int] = mapped_column(Integer, server_default="0")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
