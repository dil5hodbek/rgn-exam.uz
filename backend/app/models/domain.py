import enum
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def uuid4() -> uuid.UUID:
    return uuid.uuid4()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    STUDENT = "STUDENT"
    TEACHER = "TEACHER"
    ADMIN = "ADMIN"
    SUPER_ADMIN = "SUPER_ADMIN"
    # Runs proctored exam sessions: generates a session password, approves
    # students who enter it, watches their clocks and can pause them. Also
    # manages student usernames and standing exam access grants.
    EXAMINER = "EXAMINER"


class ContentStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class AttemptStatus(str, enum.Enum):
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    PENDING_REVIEW = "PENDING_REVIEW"
    GRADED = "GRADED"


class ImportStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone_number: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    # Optional sign-in name an examiner assigns to a student (stored
    # lower-case); login accepts it in place of the phone number.
    username: Mapped[str | None] = mapped_column(String(40), unique=True, index=True, nullable=True)
    # Exam mode (fullscreen lock + leave counter) is on for everyone by
    # default; an examiner/admin can switch it off for one student.
    exam_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.STUDENT)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    theme: Mapped[str] = mapped_column(String(16), default="system")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    telegram_link: Mapped["TelegramLink | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


class TelegramLink(Base):
    __tablename__ = "telegram_links"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    chat_id: Mapped[str] = mapped_column(String(64), unique=True)
    telegram_user_id: Mapped[str] = mapped_column(String(64), unique=True)
    verified_phone: Mapped[str] = mapped_column(String(16))
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    user: Mapped[User] = relationship(back_populates="telegram_link")


class Level(Base):
    __tablename__ = "levels"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    order_index: Mapped[int] = mapped_column(Integer, default=0)


class ExamType(Base):
    __tablename__ = "exam_types"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)


class TestVariant(Base):
    __tablename__ = "test_variants"
    __table_args__ = (UniqueConstraint("level_id", "exam_type_id", "variant_number"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    level_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("levels.id"), index=True)
    exam_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exam_types.id"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    variant_number: Mapped[int] = mapped_column(Integer)
    instructions: Mapped[str] = mapped_column(Text, default="")
    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=60)
    passing_percentage: Mapped[int] = mapped_column(Integer, default=60)
    retake_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    review_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[ContentStatus] = mapped_column(Enum(ContentStatus), default=ContentStatus.DRAFT)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    sections: Mapped[list["Section"]] = relationship(cascade="all, delete-orphan", order_by="Section.order_index")


class Section(Base):
    __tablename__ = "sections"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    test_variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_variants.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    tasks: Mapped[list["Task"]] = relationship(cascade="all, delete-orphan", order_by="Task.order_index")


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    file_name: Mapped[str] = mapped_column(String(255))
    file_url: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(80))
    transcript: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    section_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(160), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    passage_html: Mapped[str | None] = mapped_column(Text)
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_assets.id"), index=True)
    audio_replay_limit: Mapped[int | None] = mapped_column(Integer)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    questions: Mapped[list["Question"]] = relationship(cascade="all, delete-orphan", order_by="Question.order_index")


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    rich_content: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    options: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    correct_answer: Mapped[Any | None] = mapped_column(JSONB)
    accepted_answers: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    points: Mapped[float] = mapped_column(Numeric(8, 2), default=1)
    explanation: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(String(20), default="standard")
    is_example: Mapped[bool] = mapped_column(Boolean, default=False)
    case_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    normalize_spaces: Mapped[bool] = mapped_column(Boolean, default=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    test_variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("test_variants.id"), index=True)
    status: Mapped[AttemptStatus] = mapped_column(Enum(AttemptStatus), default=AttemptStatus.IN_PROGRESS)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_score: Mapped[float | None] = mapped_column(Numeric(8, 2))
    max_score: Mapped[float | None] = mapped_column(Numeric(8, 2))
    percentage: Mapped[float | None] = mapped_column(Numeric(6, 2))
    time_spent_seconds: Mapped[int | None] = mapped_column(Integer)
    # Exercise (Task) order shuffled once when the attempt starts, as a list of
    # task ID strings within their section — null means "use Task.order_index
    # as-is" (older attempts, or a variant with shuffling disabled).
    task_order: Mapped[list[str] | None] = mapped_column(JSONB)
    # "Random test" mixes in a slice of exercises borrowed from the OTHER exam
    # type at the same level (e.g. 25% End-course tasks inside a Mid-course
    # attempt) — their Task IDs live here, on top of test_variant_id's own
    # sections/tasks/questions. Null/empty for a pure single-variant attempt.
    extra_task_ids: Mapped[list[str] | None] = mapped_column(JSONB)
    # "Level test" narrows test_variant_id's own sections down to only these
    # Task IDs (instead of using all of them) — used together with
    # extra_task_ids so a level-wide test can draw ~50% of its exercises from
    # the primary variant and ~50% from the other exam type, rather than the
    # primary variant contributing 100% of its own tasks. Null means "use all
    # of the primary variant's tasks" (every other attempt kind).
    primary_task_ids: Mapped[list[str] | None] = mapped_column(JSONB)
    # Set when the attempt was started through a proctored exam session (the
    # student entered an examiner's session password and was approved).
    # Those attempts run on the examiner's clock: only the examiner can pause
    # them, and the student's own "save & exit" no longer freezes the timer.
    exam_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("exam_sessions.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    # Examiner pause: while set, the clock is frozen at paused_at and the
    # student cannot save answers. Resuming shifts started_at forward by the
    # paused duration, so elapsed time = (paused_at or now) - started_at.
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Exam mode: times the student left fullscreen or switched to another
    # window/app. Reaching MAX_EXAM_VIOLATIONS auto-submits the attempt.
    violation_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    answers: Mapped[list["AttemptAnswer"]] = relationship(cascade="all, delete-orphan")


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attempts.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id"), index=True)
    student_answer: Mapped[Any | None] = mapped_column(JSONB)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    points_awarded: Mapped[float | None] = mapped_column(Numeric(8, 2))
    feedback: Mapped[str | None] = mapped_column(Text)
    rubric_scores: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    graded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    file_name: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[ImportStatus] = mapped_column(Enum(ImportStatus), default=ImportStatus.QUEUED)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    warnings: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SessionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    CLOSED = "CLOSED"


class ParticipantStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REMOVED = "REMOVED"


class GrantScope(str, enum.Enum):
    ALL = "ALL"
    LEVEL = "LEVEL"
    EXAM_TYPE = "EXAM_TYPE"
    VARIANT = "VARIANT"


class ExamSession(Base):
    """One sitting of one published test, run by an examiner. Students who
    enter `code` on that exact test wait as PENDING participants until the
    examiner approves them; only then can they start their attempt."""
    __tablename__ = "exam_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    examiner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    test_variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_variants.id", ondelete="CASCADE"), index=True,
    )
    title: Mapped[str] = mapped_column(String(180), default="")
    code: Mapped[str] = mapped_column(String(12), index=True)
    status: Mapped[str] = mapped_column(String(16), default=SessionStatus.ACTIVE.value)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExamSessionParticipant(Base):
    __tablename__ = "exam_session_participants"
    __table_args__ = (UniqueConstraint("session_id", "user_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exam_sessions.id", ondelete="CASCADE"), index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default=ParticipantStatus.PENDING.value)
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Heartbeat from the student's exam screen — the examiner panel shows
    # anyone not seen for a short while as "left the exam".
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExamAccessGrant(Base):
    """Standing permission for a student to open tests without a session
    password: every test (ALL), one level (LEVEL), one exam type within a
    level (EXAM_TYPE), or one specific test variant (VARIANT)."""
    __tablename__ = "exam_access_grants"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(16))
    level_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("levels.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    exam_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("exam_types.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    test_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("test_variants.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
