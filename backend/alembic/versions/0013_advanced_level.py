"""A fifth level after Intermediate: Advanced (IELTS preparation).

Placed after every existing level, so the course order stays
Beginner → Elementary → Pre-Intermediate → Intermediate → Advanced.

Revision ID: 0013
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "INSERT INTO levels (id, name, slug, description, order_index) "
        "SELECT CAST(:id AS uuid), 'Advanced', 'advanced', 'IELTS preparation and confident, complex English.', "
        "COALESCE((SELECT MAX(order_index) FROM levels), 0) + 1 "
        "WHERE NOT EXISTS (SELECT 1 FROM levels WHERE slug = 'advanced' OR name = 'Advanced')"
    ).bindparams(id=str(uuid.uuid4())))


def downgrade():
    # Only when nothing hangs off it yet.
    op.execute(
        "DELETE FROM levels WHERE slug = 'advanced' "
        "AND NOT EXISTS (SELECT 1 FROM test_variants v WHERE v.level_id = levels.id)"
    )
