"""create surveys and survey_members

Revision ID: a031220c1c53
Revises: 6409f5f638c5

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a031220c1c53"
down_revision: str | Sequence[str] | None = "6409f5f638c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "surveys",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.Text(), server_default="", nullable=False),
        sa.Column("status", sa.Text(), server_default="draft", nullable=False),
        sa.Column("draft", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "draft_updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Foreign key to survey_versions is added with that table (Phase 3).
        sa.Column("current_version_id", sa.UUID(), nullable=True),
        sa.Column(
            "has_unpublished_changes", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("open_to_all", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'closed')", name=op.f("ck_surveys_status_valid")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_surveys")),
    )
    op.create_table(
        "survey_members",
        sa.Column("survey_id", sa.UUID(), nullable=False),
        sa.Column("employee_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "role IN ('owner', 'coowner', 'viewer')", name=op.f("ck_survey_members_role_valid")
        ),
        sa.ForeignKeyConstraint(
            ["survey_id"],
            ["surveys.id"],
            name=op.f("fk_survey_members_survey_id_surveys"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("survey_id", "employee_id", name=op.f("pk_survey_members")),
    )


def downgrade() -> None:
    op.drop_table("survey_members")
    op.drop_table("surveys")
