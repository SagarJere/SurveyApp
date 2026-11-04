"""Theme images: company gallery (survey_id null) and per-survey uploads."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ThemeAsset(Base):
    __tablename__ = "theme_assets"
    __table_args__ = (
        CheckConstraint("kind IN ('gallery', 'upload')", name="kind_valid"),
        CheckConstraint("(kind = 'gallery') = (survey_id IS NULL)", name="gallery_has_no_survey"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    survey_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)  # full-size WebP, relative to FILE_STORAGE_PATH
    mobile_path: Mapped[str] = mapped_column(Text)  # ~800px wide WebP
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
