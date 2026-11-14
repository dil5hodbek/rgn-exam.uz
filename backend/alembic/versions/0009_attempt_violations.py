"""Exam mode: count how many times a student left it (fullscreen / switched
app), and a per-student switch to turn it off.

Revision ID: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "attempts",
        sa.Column("violation_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("exam_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    op.drop_column("users", "exam_mode_enabled")
    op.drop_column("attempts", "violation_count")
