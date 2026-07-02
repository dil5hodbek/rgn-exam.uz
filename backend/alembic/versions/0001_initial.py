"""Initial ExamFlow schema.

Revision ID: 0001
"""
from alembic import op

from app.core.database import Base
from app.models import *  # noqa: F403

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade():
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
