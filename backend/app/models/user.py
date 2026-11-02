"""People with elevated roles. Anyone not listed here is an employee."""

from datetime import datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

ElevatedRole = Literal["admin", "hr"]


class AppUser(Base):
    __tablename__ = "app_users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'hr')", name="role_valid"),
        CheckConstraint(
            "employee_id <> '' AND employee_id = upper(btrim(employee_id))",
            name="employee_id_normalised",
        ),
    )

    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
