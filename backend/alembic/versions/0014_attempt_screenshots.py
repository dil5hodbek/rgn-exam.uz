"""Exam mode: count screenshot attempts separately, so the examiner sees
"screenshot taken" next to the student (each one is also a violation).

Revision ID: 0014
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "attempts",
        sa.Column("screenshot_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("attempts", "screenshot_count")
