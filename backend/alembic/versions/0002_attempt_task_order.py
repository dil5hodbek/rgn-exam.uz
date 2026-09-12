"""Add attempts.task_order for per-attempt exercise shuffling.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attempts", sa.Column("task_order", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("attempts", "task_order")
