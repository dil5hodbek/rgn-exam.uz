"""Add TEACHER to the role enum for the monitor panel.

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
    # Postgres < 12, but modern Postgres (this project targets 16) allows it
    # as long as it's not combined with a use of the new value in the same
    # transaction, which alembic's autocommit-per-migration already satisfies.
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'TEACHER'")


def downgrade():
    # Postgres has no ALTER TYPE ... DROP VALUE — removing an enum value
    # requires rebuilding the type, which isn't worth doing for a downgrade
    # path. Leaving TEACHER defined is harmless if unused.
    pass
