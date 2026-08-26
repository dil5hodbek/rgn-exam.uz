"""Add attempts.primary_task_ids for level-wide 50/50 mixed tests.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attempts", sa.Column("primary_task_ids", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("attempts", "primary_task_ids")
