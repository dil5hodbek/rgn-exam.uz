"""Add avatar_url to users.

Revision ID: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("avatar_url", sa.String(length=500), nullable=True))


def downgrade():
    op.drop_column("users", "avatar_url")
