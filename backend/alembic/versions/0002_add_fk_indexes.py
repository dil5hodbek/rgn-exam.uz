"""Add indexes on foreign key columns used in frequent joins/filters.

Revision ID: 0002
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_test_variants_level_id", "test_variants", "level_id"),
    ("ix_test_variants_exam_type_id", "test_variants", "exam_type_id"),
    ("ix_test_variants_created_by", "test_variants", "created_by"),
    ("ix_sections_test_variant_id", "sections", "test_variant_id"),
    ("ix_media_assets_uploaded_by", "media_assets", "uploaded_by"),
    ("ix_tasks_section_id", "tasks", "section_id"),
    ("ix_tasks_media_asset_id", "tasks", "media_asset_id"),
    ("ix_questions_task_id", "questions", "task_id"),
    ("ix_attempts_user_id", "attempts", "user_id"),
    ("ix_attempts_test_variant_id", "attempts", "test_variant_id"),
    ("ix_attempt_answers_attempt_id", "attempt_answers", "attempt_id"),
    ("ix_attempt_answers_question_id", "attempt_answers", "question_id"),
    ("ix_attempt_answers_graded_by", "attempt_answers", "graded_by"),
    ("ix_import_jobs_created_by", "import_jobs", "created_by"),
    ("ix_admin_audit_logs_actor_id", "admin_audit_logs", "actor_id"),
]


def upgrade():
    for index_name, table_name, column_name in INDEXES:
        op.create_index(index_name, table_name, [column_name])


def downgrade():
    for index_name, table_name, _column_name in INDEXES:
        op.drop_index(index_name, table_name=table_name)
