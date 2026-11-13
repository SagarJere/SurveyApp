"""store empty version json as sql null

Revision ID: 43e88922123e
Revises: 0a40ca2289bc
Create Date: 2026-11-13 17:08:21.075124+00:00

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '43e88922123e'
down_revision: str | Sequence[str] | None = '0a40ca2289bc'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COLUMNS = (
    ("survey_sections", "condition"),
    ("survey_sections", "video"),
    ("survey_questions", "condition"),
    ("survey_questions", "quiz"),
)


def upgrade() -> None:
    """Optional JSON values become SQL NULL instead of a JSON null (data only)."""
    for table, column in COLUMNS:
        op.execute(f"UPDATE {table} SET {column} = NULL WHERE {column} = 'null'::jsonb")  # noqa: S608


def downgrade() -> None:
    """Nothing to undo: SQL NULL reads back exactly like a JSON null."""
