"""Who may open which test, and the proctored-session clock.

Students no longer see every published test as open. A student can start a
test only when either
  * an examiner gave them a standing access grant that covers it (every test,
    a whole level, one exam type within a level, or one specific variant), or
  * they entered the password of an ACTIVE exam session for that exact test
    and the examiner approved them (see app/api/v1/exam_sessions.py).
Staff accounts (teachers, examiners, admins) are never locked out, so they
can preview content.
"""
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Attempt, ExamAccessGrant, ExamSession, ExamSessionParticipant, GrantScope, ParticipantStatus, Role,
    SessionStatus, TestVariant, User,
)

LOCKED_MESSAGE = "Bu imtihon yopiq. Examiner bergan parolni kiriting."


def is_staff(user: User) -> bool:
    return user.role != Role.STUDENT


def locked_error(message: str = LOCKED_MESSAGE) -> HTTPException:
    return HTTPException(403, {"code": "EXAM_LOCKED", "message": message})


async def user_grants(db: AsyncSession, user_id: uuid.UUID) -> list[ExamAccessGrant]:
    return list((await db.execute(
        select(ExamAccessGrant).where(ExamAccessGrant.user_id == user_id)
    )).scalars().all())


def grant_covers_variant(grant: ExamAccessGrant, variant: TestVariant) -> bool:
    if grant.scope == GrantScope.ALL.value:
        return True
    if grant.scope == GrantScope.LEVEL.value:
        return grant.level_id == variant.level_id
    if grant.scope == GrantScope.EXAM_TYPE.value:
        return grant.level_id == variant.level_id and grant.exam_type_id == variant.exam_type_id
    if grant.scope == GrantScope.VARIANT.value:
        return grant.test_variant_id == variant.id
    return False


def grant_covers_scope(grant: ExamAccessGrant, level_id: uuid.UUID, exam_type_id: uuid.UUID | None) -> bool:
    """Random tests (one level + exam type) and level tests (exam_type_id=None,
    mixing both exam types) draw from many variants, so only a grant that
    covers the whole pool unlocks them — a single-variant grant does not."""
    if grant.scope == GrantScope.ALL.value:
        return True
    if grant.scope == GrantScope.LEVEL.value:
        return grant.level_id == level_id
    if grant.scope == GrantScope.EXAM_TYPE.value and exam_type_id is not None:
        return grant.level_id == level_id and grant.exam_type_id == exam_type_id
    return False


async def can_open_variant(db: AsyncSession, user: User, variant: TestVariant) -> bool:
    if is_staff(user):
        return True
    return any(grant_covers_variant(grant, variant) for grant in await user_grants(db, user.id))


async def ensure_variant_access(db: AsyncSession, user: User, variant: TestVariant) -> None:
    if not await can_open_variant(db, user, variant):
        raise locked_error()


async def ensure_scope_access(
    db: AsyncSession, user: User, level_id: uuid.UUID, exam_type_id: uuid.UUID | None,
) -> None:
    if is_staff(user):
        return
    grants = await user_grants(db, user.id)
    if not any(grant_covers_scope(grant, level_id, exam_type_id) for grant in grants):
        raise locked_error("Bu test yopiq. Unga kirish uchun examiner ruxsat berishi kerak.")


# --- Clock -----------------------------------------------------------------

def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def attempt_elapsed_seconds(attempt: Attempt, now: datetime | None = None) -> float:
    """Elapsed exam time. While an examiner pause is active the clock stands
    still at paused_at; resume_attempt() shifts started_at forward by the
    paused span, so time spent paused is never counted."""
    now = now or datetime.now(timezone.utc)
    end = _aware(attempt.paused_at) if attempt.paused_at else now
    return max(0.0, (end - _aware(attempt.started_at)).total_seconds())


def remaining_seconds(attempt: Attempt, time_limit_minutes: int, now: datetime | None = None) -> int:
    return max(0, int(time_limit_minutes * 60 - attempt_elapsed_seconds(attempt, now)))


def pause_attempt_clock(attempt: Attempt) -> bool:
    if attempt.paused_at is not None:
        return False
    attempt.paused_at = datetime.now(timezone.utc)
    return True


def resume_attempt_clock(attempt: Attempt) -> bool:
    if attempt.paused_at is None:
        return False
    now = datetime.now(timezone.utc)
    attempt.started_at = _aware(attempt.started_at) + (now - _aware(attempt.paused_at))
    attempt.paused_at = None
    return True


# --- Sessions --------------------------------------------------------------

async def generate_session_code(db: AsyncSession) -> str:
    """Six digits, unique among ACTIVE sessions (closed sessions may reuse a
    code, since a closed session can't be joined any more)."""
    for _ in range(50):
        code = f"{secrets.randbelow(1_000_000):06d}"
        clash = await db.scalar(select(ExamSession.id).where(
            ExamSession.code == code, ExamSession.status == SessionStatus.ACTIVE.value,
        ))
        if not clash:
            return code
    raise HTTPException(503, "Could not generate a unique exam password. Try again.")


async def session_participant_for_attempt(
    db: AsyncSession, attempt: Attempt,
) -> ExamSessionParticipant | None:
    if attempt.exam_session_id is None:
        return None
    return await db.scalar(select(ExamSessionParticipant).where(
        ExamSessionParticipant.session_id == attempt.exam_session_id,
        ExamSessionParticipant.user_id == attempt.user_id,
    ))


async def ensure_session_attempt_allowed(db: AsyncSession, attempt: Attempt) -> None:
    """A proctored attempt keeps working only while its participant row is
    still APPROVED — an examiner who removes a student locks them out."""
    if attempt.exam_session_id is None:
        return
    participant = await session_participant_for_attempt(db, attempt)
    if not participant or participant.status != ParticipantStatus.APPROVED.value:
        raise locked_error("Examiner sizni bu imtihondan chiqarib yubordi.")
