"""Pre-exam briefing: a new attempt waits on the rules screen and its clock
starts only when the student presses "Start" (POST /attempts/{id}/begin).
Existing attempts already started, so they default to false.

Revision ID: 0010
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "attempts",
        sa.Column("awaiting_start", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("attempts", "awaiting_start")
