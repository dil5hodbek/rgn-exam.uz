"""Examiner role, student usernames, proctored exam sessions and access grants.

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    # Same pattern as 0005: adding an enum value is fine on Postgres 16 as long
    # as this migration doesn't also use the new value.
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'EXAMINER'")

    op.add_column("users", sa.Column("username", sa.String(length=40), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "exam_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("examiner_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "test_variant_id", UUID(as_uuid=True),
            sa.ForeignKey("test_variants.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("title", sa.String(length=180), nullable=False, server_default=""),
        sa.Column("code", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_exam_sessions_examiner_id", "exam_sessions", ["examiner_id"])
    op.create_index("ix_exam_sessions_test_variant_id", "exam_sessions", ["test_variant_id"])
    op.create_index("ix_exam_sessions_code", "exam_sessions", ["code"])

    op.add_column("attempts", sa.Column(
        "exam_session_id", UUID(as_uuid=True),
        sa.ForeignKey("exam_sessions.id", ondelete="SET NULL"), nullable=True,
    ))
    op.create_index("ix_attempts_exam_session_id", "attempts", ["exam_session_id"])
    op.add_column("attempts", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "exam_session_participants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id", UUID(as_uuid=True),
            sa.ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="PENDING"),
        sa.Column(
            "attempt_id", UUID(as_uuid=True),
            sa.ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("session_id", "user_id"),
    )
    op.create_index("ix_exam_session_participants_session_id", "exam_session_participants", ["session_id"])
    op.create_index("ix_exam_session_participants_user_id", "exam_session_participants", ["user_id"])
    op.create_index("ix_exam_session_participants_attempt_id", "exam_session_participants", ["attempt_id"])

    op.create_table(
        "exam_access_grants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("level_id", UUID(as_uuid=True), sa.ForeignKey("levels.id", ondelete="CASCADE"), nullable=True),
        sa.Column(
            "exam_type_id", UUID(as_uuid=True), sa.ForeignKey("exam_types.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "test_variant_id", UUID(as_uuid=True),
            sa.ForeignKey("test_variants.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "granted_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for column in ("user_id", "level_id", "exam_type_id", "test_variant_id", "granted_by"):
        op.create_index(f"ix_exam_access_grants_{column}", "exam_access_grants", [column])


def downgrade():
    op.drop_table("exam_access_grants")
    op.drop_table("exam_session_participants")
    op.drop_index("ix_attempts_exam_session_id", table_name="attempts")
    op.drop_column("attempts", "paused_at")
    op.drop_column("attempts", "exam_session_id")
    op.drop_table("exam_sessions")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
    # EXAMINER stays in the role enum (see 0005 for why).
