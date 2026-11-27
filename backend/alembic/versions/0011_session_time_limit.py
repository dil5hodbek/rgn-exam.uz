"""Examiner-set exam length: each exam session has its own time limit
(default 60 minutes) that the examiner can change while it runs. Existing
sessions keep the length their test had, so nothing changes for them.

Revision ID: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "exam_sessions",
        sa.Column("time_limit_minutes", sa.Integer(), nullable=False, server_default="60"),
    )
    op.execute(
        "UPDATE exam_sessions SET time_limit_minutes = test_variants.time_limit_minutes "
        "FROM test_variants WHERE test_variants.id = exam_sessions.test_variant_id"
    )


def downgrade():
    op.drop_column("exam_sessions", "time_limit_minutes")
