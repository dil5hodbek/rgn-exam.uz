"""Unit tests and an examiner-set pass mark.

* A third exam type, "Unit Test" (slug unit-test), next to Mid-course and
  End-course. Its variant number is the unit number.
* exam_sessions.passing_percentage: the pass mark an examiner sets for one
  sitting. Existing sessions copy their test's pass mark, so nothing changes.

Revision ID: 0012
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "INSERT INTO exam_types (id, name, slug) "
        "SELECT CAST(:id AS uuid), 'Unit Test', 'unit-test' "
        "WHERE NOT EXISTS (SELECT 1 FROM exam_types WHERE slug = 'unit-test' OR name = 'Unit Test')"
    ).bindparams(id=str(uuid.uuid4())))
    op.add_column(
        "exam_sessions",
        sa.Column("passing_percentage", sa.Integer(), nullable=False, server_default="60"),
    )
    op.execute(
        "UPDATE exam_sessions SET passing_percentage = test_variants.passing_percentage "
        "FROM test_variants WHERE test_variants.id = exam_sessions.test_variant_id"
    )


def downgrade():
    op.drop_column("exam_sessions", "passing_percentage")
    # The Unit Test exam type stays: tests may already point at it.
