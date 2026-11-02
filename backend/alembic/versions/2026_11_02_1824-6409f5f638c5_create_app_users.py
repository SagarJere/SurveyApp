"""create app_users

Revision ID: 6409f5f638c5
Revises:
Create Date: 2026-11-02 18:24:00.773129+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6409f5f638c5"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("employee_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "employee_id <> '' AND employee_id = upper(btrim(employee_id))",
            name=op.f("ck_app_users_employee_id_normalised"),
        ),
        sa.CheckConstraint("role IN ('admin', 'hr')", name=op.f("ck_app_users_role_valid")),
        sa.PrimaryKeyConstraint("employee_id", name=op.f("pk_app_users")),
    )


def downgrade() -> None:
    op.drop_table("app_users")
