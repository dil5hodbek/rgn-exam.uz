"""Add attempts.extra_task_ids for cross-exam-type mixed random tests.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attempts", sa.Column("extra_task_ids", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("attempts", "extra_task_ids")
