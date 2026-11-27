"""Proctored exam sessions and the examiner panel.

Flow:
  1. An examiner picks a published test and starts a session; the system
     generates a 6-digit password for it.
  2. A student opens that test, enters the password and becomes a PENDING
     participant.
  3. The examiner approves them; the student's waiting screen notices and
     starts the attempt (the clock starts only now).
  4. While the student works, the examiner sees who is online, how much time
     each student has left and how far along they are, and can pause/resume
     a student (or everyone), force-submit, or remove them.
Examiners also manage the student base: usernames, passwords and standing
access grants that let a student open tests without any password.
"""
import math
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.attempts import attempt_sections, create_attempt, finalize_attempt
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import current_user, require_examiner
from app.core.security import hash_password, normalize_username
from app.models import (
    Attempt, AttemptAnswer, AttemptStatus, ContentStatus, ExamAccessGrant, ExamSession, ExamSessionParticipant,
    ExamType, GrantScope, Level, ParticipantStatus, Question, Role, Section, SessionStatus, Task, TestVariant, User,
)
from app.services.audit import write_audit
from app.services.exercise_registry import MANUAL_TASK_TYPES
from app.services.exam_access import (
    DEFAULT_SESSION_MINUTES, MAX_EXAM_VIOLATIONS, MAX_SESSION_MINUTES, MIN_SESSION_MINUTES, generate_session_code,
    pause_attempt_clock, remaining_seconds, resume_attempt_clock, attempt_elapsed_seconds,
)

router = APIRouter(tags=["Exam sessions"])

# A student whose exam screen hasn't sent a heartbeat for this long is shown
# to the examiner as having left the exam (the screen pings every ~5s).
ONLINE_WINDOW_SECONDS = 20
JOIN_FAIL_LIMIT = 10
JOIN_FAIL_WINDOW_SECONDS = 600


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


class JoinRequest(BaseModel):
    code: str = Field(min_length=4, max_length=20)
    # The test the student clicked; the password must belong to exactly it.
    test_variant_id: uuid.UUID | None = None


class SessionCreate(BaseModel):
    test_variant_id: uuid.UUID
    title: str = Field(default="", max_length=180)
    time_limit_minutes: int = Field(default=DEFAULT_SESSION_MINUTES, ge=MIN_SESSION_MINUTES, le=MAX_SESSION_MINUTES)


class SessionUpdate(BaseModel):
    time_limit_minutes: int = Field(ge=MIN_SESSION_MINUTES, le=MAX_SESSION_MINUTES)


class SessionClose(BaseModel):
    submit_in_progress: bool = False


class StudentUpdate(BaseModel):
    # None = leave unchanged, "" = remove the username.
    username: str | None = Field(default=None, max_length=40)
    password: str | None = Field(default=None, min_length=4, max_length=128)
    # Exam mode (fullscreen lock + leave counter); None = leave unchanged.
    exam_mode: bool | None = None


class GrantCreate(BaseModel):
    scope: GrantScope
    level_id: uuid.UUID | None = None
    exam_type_id: uuid.UUID | None = None
    test_variant_id: uuid.UUID | None = None


# --- shared helpers -------------------------------------------------------

async def variant_meta(db: AsyncSession, variant_ids: set[uuid.UUID]) -> dict[uuid.UUID, dict]:
    if not variant_ids:
        return {}
    rows = (await db.execute(
        select(TestVariant, Level, ExamType)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .where(TestVariant.id.in_(variant_ids))
    )).all()
    return {variant.id: {
        "test_variant_id": variant.id, "test_title": variant.title, "variant_number": variant.variant_number,
        "time_limit_minutes": variant.time_limit_minutes, "passing_percentage": variant.passing_percentage,
        "level_id": level.id, "level_name": level.name, "level_slug": level.slug,
        "exam_type_id": exam_type.id, "exam_type_name": exam_type.name, "exam_type_slug": exam_type.slug,
    } for variant, level, exam_type in rows}


async def question_counts(db: AsyncSession, variant_ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not variant_ids:
        return {}
    rows = (await db.execute(
        select(Section.test_variant_id, func.count(Question.id))
        .join(Task, Task.section_id == Section.id)
        .join(Question, Question.task_id == Task.id)
        .where(Section.test_variant_id.in_(variant_ids), Question.is_example.is_(False))
        .group_by(Section.test_variant_id)
    )).all()
    return {variant_id: count for variant_id, count in rows}


def participant_state(participant: ExamSessionParticipant, attempt: Attempt | None, time_limit: int) -> str:
    if participant.status != ParticipantStatus.APPROVED.value:
        return participant.status
    if attempt is None:
        return "APPROVED"
    if attempt.status != AttemptStatus.IN_PROGRESS:
        return "SUBMITTED"
    if attempt.paused_at is not None:
        return "PAUSED"
    if remaining_seconds(attempt, time_limit) <= 0:
        return "TIME_UP"
    return "IN_PROGRESS"


async def student_view(db: AsyncSession, session: ExamSession, participant: ExamSessionParticipant) -> dict:
    meta = (await variant_meta(db, {session.test_variant_id})).get(session.test_variant_id, {})
    attempt = await db.get(Attempt, participant.attempt_id) if participant.attempt_id else None
    time_limit = session.time_limit_minutes
    return {
        "session_id": session.id,
        "participant_id": participant.id,
        "title": session.title or meta.get("test_title", ""),
        "session_status": session.status,
        "status": participant.status,
        "state": participant_state(participant, attempt, time_limit),
        "attempt_id": attempt.id if attempt else None,
        "attempt_status": attempt.status if attempt else None,
        "paused": bool(attempt and attempt.paused_at is not None),
        "remaining_seconds": remaining_seconds(attempt, time_limit) if attempt else time_limit * 60,
        **meta,
        "time_limit_minutes": time_limit,
    }


# --- student side ---------------------------------------------------------

@router.post("/exam-sessions/join")
async def join_session(payload: JoinRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Enter an examiner's session password. Puts the student in the waiting
    room (PENDING) until the examiner approves them."""
    fails_key = f"exam-join-fails:{user.id}"
    async with redis_client() as redis:
        if int(await redis.get(fails_key) or 0) >= JOIN_FAIL_LIMIT:
            raise HTTPException(429, "Juda ko'p noto'g'ri urinish. 10 daqiqadan keyin qayta urinib ko'ring.")
    code = re.sub(r"\D", "", payload.code)
    session = await db.scalar(select(ExamSession).where(
        ExamSession.code == code, ExamSession.status == SessionStatus.ACTIVE.value,
    )) if code else None
    if not session:
        async with redis_client() as redis:
            fails = await redis.incr(fails_key)
            if fails == 1:
                await redis.expire(fails_key, JOIN_FAIL_WINDOW_SECONDS)
        raise HTTPException(404, "Parol noto'g'ri yoki imtihon yakunlangan.")
    if payload.test_variant_id and payload.test_variant_id != session.test_variant_id:
        raise HTTPException(400, "Bu parol boshqa imtihon uchun berilgan.")
    participant = await db.scalar(select(ExamSessionParticipant).where(
        ExamSessionParticipant.session_id == session.id, ExamSessionParticipant.user_id == user.id,
    ))
    if participant is None:
        participant = ExamSessionParticipant(session_id=session.id, user_id=user.id)
        db.add(participant)
    elif participant.status == ParticipantStatus.REMOVED.value:
        raise HTTPException(403, "Examiner sizni bu imtihondan chiqarib yuborgan.")
    elif participant.status == ParticipantStatus.REJECTED.value:
        # Asking again after a rejection goes back into the waiting room.
        participant.status = ParticipantStatus.PENDING.value
        participant.requested_at = _now()
        participant.decided_at = None
    await db.commit()
    await db.refresh(participant)
    return await student_view(db, session, participant)


@router.get("/exam-sessions/mine")
async def my_sessions(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Sessions the student is waiting in or still sitting — the dashboard
    shows these as "continue your exam" so leaving never strands anyone."""
    rows = (await db.execute(
        select(ExamSessionParticipant, ExamSession)
        .join(ExamSession, ExamSession.id == ExamSessionParticipant.session_id)
        .outerjoin(Attempt, Attempt.id == ExamSessionParticipant.attempt_id)
        .where(
            ExamSessionParticipant.user_id == user.id,
            ExamSessionParticipant.status.in_([ParticipantStatus.PENDING.value, ParticipantStatus.APPROVED.value]),
            or_(
                (ExamSession.status == SessionStatus.ACTIVE.value) & (ExamSessionParticipant.attempt_id.is_(None)),
                Attempt.status == AttemptStatus.IN_PROGRESS,
            ),
        )
        .order_by(ExamSessionParticipant.requested_at.desc())
    )).all()
    return [await student_view(db, session, participant) for participant, session in rows]


async def my_participant(db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID, lock: bool = False):
    session = await db.get(ExamSession, session_id)
    query = select(ExamSessionParticipant).where(
        ExamSessionParticipant.session_id == session_id, ExamSessionParticipant.user_id == user_id,
    )
    if lock:
        query = query.with_for_update()
    participant = await db.scalar(query)
    if not session or not participant:
        raise HTTPException(404, "Siz bu imtihonga qo'shilmagansiz.")
    return session, participant


@router.get("/exam-sessions/{session_id}/me")
async def my_session_status(session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    session, participant = await my_participant(db, session_id, user.id)
    return await student_view(db, session, participant)


@router.post("/exam-sessions/{session_id}/start")
async def start_session_attempt(
    session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db),
):
    """Approved student begins (or re-enters) their proctored attempt."""
    session, participant = await my_participant(db, session_id, user.id, lock=True)
    if participant.status == ParticipantStatus.PENDING.value:
        raise HTTPException(409, "Examiner hali tasdiqlamadi.")
    if participant.status != ParticipantStatus.APPROVED.value:
        raise HTTPException(403, "Examiner kirishingizga ruxsat bermadi.")
    if participant.attempt_id:
        attempt = await db.get(Attempt, participant.attempt_id)
        if attempt and attempt.status == AttemptStatus.IN_PROGRESS:
            participant.last_seen_at = _now()
            await db.commit()
            return await student_view(db, session, participant)
        if attempt:
            raise HTTPException(409, "Siz bu imtihonni topshirib bo'lgansiz.")
    if session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(409, "Imtihon yakunlangan.")
    variant = await db.get(TestVariant, session.test_variant_id)
    if not variant:
        raise HTTPException(404, "Test topilmadi.")
    attempt = await create_attempt(db, user.id, variant, shuffle=False, exam_session_id=session.id)
    participant.attempt_id = attempt.id
    participant.last_seen_at = _now()
    await db.commit()
    return await student_view(db, session, participant)


# --- examiner: tests & sessions ------------------------------------------

@router.get("/examiner/tests")
async def examiner_tests(_: User = Depends(require_examiner), db: AsyncSession = Depends(get_db)):
    """Everything an examiner can pick from: levels, exam types and every
    published test variant (with its question count)."""
    levels = (await db.execute(select(Level).order_by(Level.order_index))).scalars().all()
    exam_types = (await db.execute(select(ExamType).order_by(ExamType.name))).scalars().all()
    variants = (await db.execute(
        select(TestVariant).where(TestVariant.status == ContentStatus.PUBLISHED)
        .order_by(TestVariant.variant_number)
    )).scalars().all()
    counts = await question_counts(db, {variant.id for variant in variants})
    return {
        "levels": [{"id": row.id, "name": row.name, "slug": row.slug} for row in levels],
        "exam_types": [{"id": row.id, "name": row.name, "slug": row.slug} for row in exam_types],
        "variants": [{
            "id": row.id, "title": row.title, "variant_number": row.variant_number,
            "level_id": row.level_id, "exam_type_id": row.exam_type_id,
            "time_limit_minutes": row.time_limit_minutes, "question_count": counts.get(row.id, 0),
        } for row in variants],
    }


async def owned_session(db: AsyncSession, user: User, session_id: uuid.UUID) -> ExamSession:
    session = await db.get(ExamSession, session_id)
    if not session or (user.role == Role.EXAMINER and session.examiner_id != user.id):
        raise HTTPException(404, "Imtihon topilmadi.")
    return session


@router.get("/examiner/sessions")
async def list_sessions(user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db)):
    query = select(ExamSession).order_by(ExamSession.created_at.desc()).limit(200)
    if user.role == Role.EXAMINER:
        query = query.where(ExamSession.examiner_id == user.id)
    sessions = (await db.execute(query)).scalars().all()
    if not sessions:
        return []
    session_ids = [session.id for session in sessions]
    meta = await variant_meta(db, {session.test_variant_id for session in sessions})
    rows = (await db.execute(
        select(ExamSessionParticipant.session_id, ExamSessionParticipant.status, Attempt.status)
        .outerjoin(Attempt, Attempt.id == ExamSessionParticipant.attempt_id)
        .where(ExamSessionParticipant.session_id.in_(session_ids))
    )).all()
    counts: dict[uuid.UUID, dict[str, int]] = {
        session_id: {"pending": 0, "in_progress": 0, "submitted": 0, "total": 0} for session_id in session_ids
    }
    for session_id, status, attempt_status in rows:
        bucket = counts[session_id]
        if status in (ParticipantStatus.REJECTED.value, ParticipantStatus.REMOVED.value):
            continue
        bucket["total"] += 1
        if status == ParticipantStatus.PENDING.value:
            bucket["pending"] += 1
        elif attempt_status == AttemptStatus.IN_PROGRESS:
            bucket["in_progress"] += 1
        elif attempt_status is not None:
            bucket["submitted"] += 1
    writing: dict[uuid.UUID, dict[str, int]] = {}
    for session_id, is_correct, graded_by in (await db.execute(
        select(Attempt.exam_session_id, AttemptAnswer.is_correct, AttemptAnswer.graded_by)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(Task, Task.id == Question.task_id)
        .where(
            Attempt.exam_session_id.in_(session_ids), Attempt.status != AttemptStatus.IN_PROGRESS,
            Task.type.in_(MANUAL_TASK_TYPES), func.jsonb_typeof(AttemptAnswer.student_answer) != "null",
        )
    )).all():
        bucket = writing.setdefault(session_id, {"writing_total": 0, "writing_awaiting": 0})
        bucket["writing_total"] += 1
        if is_correct is None:
            bucket["writing_awaiting"] += 1
    examiners = {}
    if user.role != Role.EXAMINER:
        examiner_rows = (await db.execute(
            select(User).where(User.id.in_({session.examiner_id for session in sessions}))
        )).scalars().all()
        examiners = {row.id: f"{row.first_name} {row.last_name}" for row in examiner_rows}
    return [{
        "id": session.id, "title": session.title or meta.get(session.test_variant_id, {}).get("test_title", ""),
        "code": session.code, "status": session.status, "created_at": session.created_at,
        "closed_at": session.closed_at, "examiner_name": examiners.get(session.examiner_id),
        **meta.get(session.test_variant_id, {}), "time_limit_minutes": session.time_limit_minutes,
        **counts[session.id],
        **writing.get(session.id, {"writing_total": 0, "writing_awaiting": 0}),
    } for session in sessions]


@router.post("/examiner/sessions", status_code=201)
async def create_session(
    payload: SessionCreate, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    variant = await db.scalar(select(TestVariant).where(
        TestVariant.id == payload.test_variant_id, TestVariant.status == ContentStatus.PUBLISHED,
    ))
    if not variant:
        raise HTTPException(404, "Nashr qilingan test topilmadi.")
    session = ExamSession(
        examiner_id=user.id, test_variant_id=variant.id, title=payload.title.strip(),
        code=await generate_session_code(db), time_limit_minutes=payload.time_limit_minutes,
    )
    db.add(session)
    await db.flush()
    await write_audit(db, user.id, "exam_session.create", "ExamSession", str(session.id),
                      {"test_variant_id": str(variant.id), "time_limit_minutes": payload.time_limit_minutes},
                      _ip(request))
    await db.commit()
    return await session_detail_payload(db, session)


async def session_detail_payload(db: AsyncSession, session: ExamSession) -> dict:
    meta = (await variant_meta(db, {session.test_variant_id})).get(session.test_variant_id, {})
    time_limit = session.time_limit_minutes
    total_questions = (await question_counts(db, {session.test_variant_id})).get(session.test_variant_id, 0)
    rows = (await db.execute(
        select(ExamSessionParticipant, User, Attempt)
        .join(User, User.id == ExamSessionParticipant.user_id)
        .outerjoin(Attempt, Attempt.id == ExamSessionParticipant.attempt_id)
        .where(ExamSessionParticipant.session_id == session.id)
        .order_by(ExamSessionParticipant.requested_at)
    )).all()
    attempt_ids = [attempt.id for _, _, attempt in rows if attempt is not None]
    answered = {}
    if attempt_ids:
        answered = dict((await db.execute(
            select(AttemptAnswer.attempt_id, func.count(AttemptAnswer.id))
            .join(Question, Question.id == AttemptAnswer.question_id)
            .where(
                AttemptAnswer.attempt_id.in_(attempt_ids),
                Question.is_example.is_(False),
                func.jsonb_typeof(AttemptAnswer.student_answer) != "null",
            )
            .group_by(AttemptAnswer.attempt_id)
        )).all())
    now = _now()
    participants = []
    for participant, student, attempt in rows:
        last_seen = _aware(participant.last_seen_at)
        participants.append({
            "id": participant.id,
            "user_id": student.id,
            "first_name": student.first_name, "last_name": student.last_name,
            "phone_number": student.phone_number, "username": student.username,
            "avatar_url": student.avatar_url,
            "status": participant.status,
            "state": participant_state(participant, attempt, time_limit),
            "requested_at": participant.requested_at,
            "last_seen_at": participant.last_seen_at,
            "online": bool(last_seen and (now - last_seen).total_seconds() <= ONLINE_WINDOW_SECONDS),
            "attempt_id": attempt.id if attempt else None,
            "started_at": attempt.started_at if attempt else None,
            "paused": bool(attempt and attempt.paused_at is not None),
            "elapsed_seconds": int(attempt_elapsed_seconds(attempt, now)) if attempt else 0,
            "remaining_seconds": remaining_seconds(attempt, time_limit, now) if attempt else time_limit * 60,
            "answered_count": answered.get(attempt.id, 0) if attempt else 0,
            "violations": (attempt.violation_count or 0) if attempt else 0,
            "exam_mode": student.exam_mode_enabled is not False,
            "max_violations": MAX_EXAM_VIOLATIONS,
            "percentage": float(attempt.percentage) if attempt and attempt.percentage is not None else None,
        })
    running = [attempt for _, _, attempt in rows if attempt is not None and attempt.status == AttemptStatus.IN_PROGRESS]
    return {
        "id": session.id, "title": session.title or meta.get("test_title", ""), "code": session.code,
        "status": session.status, "created_at": session.created_at, "closed_at": session.closed_at,
        "total_questions": total_questions, **meta, "participants": participants,
        "time_limit_minutes": time_limit,
        # The test's own length, shown as a reference next to the session's.
        "test_time_limit_minutes": meta.get("time_limit_minutes"),
        # The shortest length that still leaves every working student a minute.
        "min_time_limit_minutes": min_time_limit(running, now),
        "running_count": len(running),
        "server_time": now,
    }


def min_time_limit(running: list[Attempt], now: datetime) -> int:
    longest = max((attempt_elapsed_seconds(attempt, now) for attempt in running), default=0.0)
    return max(MIN_SESSION_MINUTES, math.ceil(longest / 60) + 1)


@router.get("/examiner/sessions/{session_id}")
async def session_detail(session_id: uuid.UUID, user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db)):
    return await session_detail_payload(db, await owned_session(db, user, session_id))


@router.patch("/examiner/sessions/{session_id}")
async def update_session(
    session_id: uuid.UUID, payload: SessionUpdate, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    """Change the exam length. Applies at once to everyone: each student's
    time left becomes the new length minus the time they have already used."""
    session = await owned_session(db, user, session_id)
    running = (await db.execute(
        select(Attempt).where(Attempt.exam_session_id == session.id, Attempt.status == AttemptStatus.IN_PROGRESS)
    )).scalars().all()
    if session.status != SessionStatus.ACTIVE.value and not running:
        raise HTTPException(409, "Imtihon yakunlangan.")
    minimum = min_time_limit(list(running), _now())
    if payload.time_limit_minutes < minimum:
        raise HTTPException(409, f"Kamida {minimum} daqiqa bo'lishi kerak: ba'zi o'quvchilar shuncha vaqt ishlagan.")
    previous = session.time_limit_minutes
    session.time_limit_minutes = payload.time_limit_minutes
    await write_audit(db, user.id, "exam_session.time_limit", "ExamSession", str(session.id),
                      {"from": previous, "to": payload.time_limit_minutes}, _ip(request))
    await db.commit()
    return await session_detail_payload(db, session)


@router.post("/examiner/sessions/{session_id}/regenerate-code")
async def regenerate_code(
    session_id: uuid.UUID, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    session = await owned_session(db, user, session_id)
    if session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(409, "Imtihon yakunlangan.")
    session.code = await generate_session_code(db)
    await write_audit(db, user.id, "exam_session.new_code", "ExamSession", str(session.id), {}, _ip(request))
    await db.commit()
    return await session_detail_payload(db, session)


@router.post("/examiner/sessions/{session_id}/close")
async def close_session(
    session_id: uuid.UUID, payload: SessionClose, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    """Stop accepting new students. Anyone still waiting is turned away;
    optionally every attempt still in progress is submitted as it stands."""
    session = await owned_session(db, user, session_id)
    session.status = SessionStatus.CLOSED.value
    session.closed_at = session.closed_at or _now()
    participants = (await db.execute(select(ExamSessionParticipant).where(
        ExamSessionParticipant.session_id == session.id,
    ))).scalars().all()
    for participant in participants:
        if participant.status == ParticipantStatus.PENDING.value:
            participant.status = ParticipantStatus.REJECTED.value
            participant.decided_at = _now()
    await write_audit(db, user.id, "exam_session.close", "ExamSession", str(session.id),
                      {"submit_in_progress": payload.submit_in_progress}, _ip(request))
    await db.commit()
    if payload.submit_in_progress:
        for participant in participants:
            if not participant.attempt_id:
                continue
            attempt = await db.get(Attempt, participant.attempt_id)
            if attempt and attempt.status == AttemptStatus.IN_PROGRESS:
                await finalize_attempt(db, attempt)
    return await session_detail_payload(db, session)


async def session_participant(
    db: AsyncSession, session: ExamSession, participant_id: uuid.UUID,
) -> ExamSessionParticipant:
    participant = await db.get(ExamSessionParticipant, participant_id)
    if not participant or participant.session_id != session.id:
        raise HTTPException(404, "O'quvchi bu imtihonda topilmadi.")
    return participant


async def running_attempt(db: AsyncSession, participant: ExamSessionParticipant) -> Attempt:
    attempt = await db.get(Attempt, participant.attempt_id) if participant.attempt_id else None
    if not attempt or attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(409, "O'quvchi hozir imtihon ishlamayapti.")
    return attempt


PARTICIPANT_ACTIONS = {"approve", "reject", "remove", "pause", "resume", "submit"}


@router.post("/examiner/sessions/{session_id}/participants/{participant_id}/{action}")
async def participant_action(
    session_id: uuid.UUID, participant_id: uuid.UUID, action: str, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    if action not in PARTICIPANT_ACTIONS:
        raise HTTPException(404, "Unknown action.")
    session = await owned_session(db, user, session_id)
    participant = await session_participant(db, session, participant_id)
    if action == "approve":
        if participant.status == ParticipantStatus.REMOVED.value:
            raise HTTPException(409, "Chiqarilgan o'quvchini qayta tasdiqlab bo'lmaydi.")
        if session.status != SessionStatus.ACTIVE.value and not participant.attempt_id:
            raise HTTPException(409, "Imtihon yakunlangan.")
        participant.status = ParticipantStatus.APPROVED.value
        participant.decided_at = _now()
    elif action == "reject":
        if participant.attempt_id:
            raise HTTPException(409, "O'quvchi imtihonni boshlab bo'lgan — rad etib bo'lmaydi.")
        participant.status = ParticipantStatus.REJECTED.value
        participant.decided_at = _now()
    elif action == "remove":
        participant.status = ParticipantStatus.REMOVED.value
        participant.decided_at = _now()
    elif action == "pause":
        pause_attempt_clock(await running_attempt(db, participant))
    elif action == "resume":
        resume_attempt_clock(await running_attempt(db, participant))
    elif action == "submit":
        attempt = await running_attempt(db, participant)
        await write_audit(db, user.id, "exam_session.participant.submit", "ExamSessionParticipant",
                          str(participant.id), {}, _ip(request))
        await db.commit()
        await finalize_attempt(db, attempt)
        return await session_detail_payload(db, session)
    await write_audit(db, user.id, f"exam_session.participant.{action}", "ExamSessionParticipant",
                      str(participant.id), {"user_id": str(participant.user_id)}, _ip(request))
    await db.commit()
    return await session_detail_payload(db, session)


@router.post("/examiner/sessions/{session_id}/{action}")
async def session_bulk_action(
    session_id: uuid.UUID, action: str, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    """approve-all / pause-all / resume-all."""
    if action not in {"approve-all", "pause-all", "resume-all"}:
        raise HTTPException(404, "Unknown action.")
    session = await owned_session(db, user, session_id)
    participants = (await db.execute(select(ExamSessionParticipant).where(
        ExamSessionParticipant.session_id == session.id,
    ))).scalars().all()
    changed = 0
    for participant in participants:
        if action == "approve-all":
            if participant.status == ParticipantStatus.PENDING.value and session.status == SessionStatus.ACTIVE.value:
                participant.status = ParticipantStatus.APPROVED.value
                participant.decided_at = _now()
                changed += 1
            continue
        if participant.status != ParticipantStatus.APPROVED.value or not participant.attempt_id:
            continue
        attempt = await db.get(Attempt, participant.attempt_id)
        if not attempt or attempt.status != AttemptStatus.IN_PROGRESS:
            continue
        if action == "pause-all" and pause_attempt_clock(attempt):
            changed += 1
        elif action == "resume-all" and resume_attempt_clock(attempt):
            changed += 1
    await write_audit(db, user.id, f"exam_session.{action}", "ExamSession", str(session.id),
                      {"changed": changed}, _ip(request))
    await db.commit()
    return await session_detail_payload(db, session)


# --- examiner: student base ----------------------------------------------

def grant_payload(grant: ExamAccessGrant, names: dict) -> dict:
    return {
        "id": grant.id, "scope": grant.scope,
        "level_id": grant.level_id, "exam_type_id": grant.exam_type_id, "test_variant_id": grant.test_variant_id,
        "level_name": names["levels"].get(grant.level_id),
        "exam_type_name": names["exam_types"].get(grant.exam_type_id),
        "test_title": names["variants"].get(grant.test_variant_id),
        "created_at": grant.created_at,
    }


async def catalog_names(db: AsyncSession) -> dict:
    levels = dict((await db.execute(select(Level.id, Level.name))).all())
    exam_types = dict((await db.execute(select(ExamType.id, ExamType.name))).all())
    variants = {
        variant_id: f"{title} (V{number})"
        for variant_id, title, number in (await db.execute(
            select(TestVariant.id, TestVariant.title, TestVariant.variant_number)
        )).all()
    }
    return {"levels": levels, "exam_types": exam_types, "variants": variants}


def student_payload(student: User, grants: list[ExamAccessGrant], names: dict) -> dict:
    return {
        "id": student.id, "first_name": student.first_name, "last_name": student.last_name,
        "phone_number": student.phone_number, "username": student.username,
        "is_active": student.is_active, "created_at": student.created_at, "avatar_url": student.avatar_url,
        "exam_mode": student.exam_mode_enabled is not False,
        "grants": [grant_payload(grant, names) for grant in grants],
    }


@router.get("/examiner/students")
async def list_students(
    q: str = "", limit: int = 50, offset: int = 0,
    _: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 200))
    query = select(User).where(User.role == Role.STUDENT)
    term = q.strip()
    if term:
        like = f"%{term}%"
        digits = re.sub(r"\D", "", term)
        conditions = [
            User.first_name.ilike(like), User.last_name.ilike(like), User.username.ilike(like),
            func.concat(User.first_name, " ", User.last_name).ilike(like),
        ]
        if digits:
            conditions.append(User.phone_number.like(f"%{digits}%"))
        query = query.where(or_(*conditions))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    students = (await db.execute(
        query.order_by(User.created_at.desc()).offset(max(0, offset)).limit(limit)
    )).scalars().all()
    grants: dict[uuid.UUID, list[ExamAccessGrant]] = {student.id: [] for student in students}
    if students:
        for grant in (await db.execute(
            select(ExamAccessGrant).where(ExamAccessGrant.user_id.in_(list(grants)))
            .order_by(ExamAccessGrant.created_at)
        )).scalars().all():
            grants[grant.user_id].append(grant)
    names = await catalog_names(db)
    return {"total": total, "items": [student_payload(student, grants[student.id], names) for student in students]}


async def get_student(db: AsyncSession, student_id: uuid.UUID) -> User:
    student = await db.get(User, student_id)
    if not student or student.role != Role.STUDENT:
        raise HTTPException(404, "O'quvchi topilmadi.")
    return student


async def student_response(db: AsyncSession, student: User) -> dict:
    grants = (await db.execute(
        select(ExamAccessGrant).where(ExamAccessGrant.user_id == student.id).order_by(ExamAccessGrant.created_at)
    )).scalars().all()
    return student_payload(student, list(grants), await catalog_names(db))


@router.patch("/examiner/students/{student_id}")
async def update_student(
    student_id: uuid.UUID, payload: StudentUpdate, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    student = await get_student(db, student_id)
    changes: dict = {}
    if payload.username is not None:
        if payload.username.strip() == "":
            student.username = None
            changes["username"] = None
        else:
            username = normalize_username(payload.username)
            if not username:
                raise HTTPException(422, (
                    "Username 3-32 belgidan iborat bo'lsin, harf bilan boshlansin; "
                    "faqat lotin harflari, raqam, nuqta va _ ishlatiladi."
                ))
            clash = await db.scalar(select(User.id).where(User.username == username, User.id != student.id))
            if clash:
                raise HTTPException(409, "Bu username band.")
            student.username = username
            changes["username"] = username
    if payload.password:
        student.password_hash = hash_password(payload.password)
        changes["password"] = "changed"
    if payload.exam_mode is not None:
        student.exam_mode_enabled = payload.exam_mode
        changes["exam_mode"] = payload.exam_mode
    await write_audit(db, user.id, "examiner.student.update", "User", str(student.id), changes, _ip(request))
    await db.commit()
    await db.refresh(student)
    return await student_response(db, student)


@router.post("/examiner/students/{student_id}/grants", status_code=201)
async def add_grant(
    student_id: uuid.UUID, payload: GrantCreate, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    student = await get_student(db, student_id)
    level_id = exam_type_id = variant_id = None
    if payload.scope == GrantScope.LEVEL:
        if not payload.level_id or not await db.get(Level, payload.level_id):
            raise HTTPException(422, "Darajani tanlang.")
        level_id = payload.level_id
    elif payload.scope == GrantScope.EXAM_TYPE:
        if not payload.level_id or not await db.get(Level, payload.level_id):
            raise HTTPException(422, "Darajani tanlang.")
        if not payload.exam_type_id or not await db.get(ExamType, payload.exam_type_id):
            raise HTTPException(422, "Imtihon turini tanlang.")
        level_id, exam_type_id = payload.level_id, payload.exam_type_id
    elif payload.scope == GrantScope.VARIANT:
        variant = await db.get(TestVariant, payload.test_variant_id) if payload.test_variant_id else None
        if not variant:
            raise HTTPException(422, "Testni tanlang.")
        variant_id = variant.id
    duplicate = await db.scalar(select(ExamAccessGrant.id).where(
        ExamAccessGrant.user_id == student.id, ExamAccessGrant.scope == payload.scope.value,
        ExamAccessGrant.level_id.is_(level_id) if level_id is None else ExamAccessGrant.level_id == level_id,
        ExamAccessGrant.exam_type_id.is_(exam_type_id) if exam_type_id is None
        else ExamAccessGrant.exam_type_id == exam_type_id,
        ExamAccessGrant.test_variant_id.is_(variant_id) if variant_id is None
        else ExamAccessGrant.test_variant_id == variant_id,
    ))
    if not duplicate:
        db.add(ExamAccessGrant(
            user_id=student.id, scope=payload.scope.value, level_id=level_id, exam_type_id=exam_type_id,
            test_variant_id=variant_id, granted_by=user.id,
        ))
        await write_audit(db, user.id, "examiner.grant.add", "User", str(student.id), {
            "scope": payload.scope.value, "level_id": str(level_id) if level_id else None,
            "exam_type_id": str(exam_type_id) if exam_type_id else None,
            "test_variant_id": str(variant_id) if variant_id else None,
        }, _ip(request))
        await db.commit()
    return await student_response(db, student)


@router.delete("/examiner/grants/{grant_id}")
async def remove_grant(
    grant_id: uuid.UUID, request: Request,
    user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    grant = await db.get(ExamAccessGrant, grant_id)
    if not grant:
        raise HTTPException(404, "Ruxsat topilmadi.")
    student = await get_student(db, grant.user_id)
    await db.delete(grant)
    await write_audit(db, user.id, "examiner.grant.remove", "User", str(student.id),
                      {"scope": grant.scope}, _ip(request))
    await db.commit()
    return await student_response(db, student)


@router.get("/examiner/students/{student_id}/attempts")
async def student_attempts(
    student_id: uuid.UUID, _: User = Depends(require_examiner), db: AsyncSession = Depends(get_db),
):
    student = await get_student(db, student_id)
    rows = (await db.execute(
        select(Attempt, TestVariant)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .where(Attempt.user_id == student.id)
        .order_by(Attempt.started_at.desc()).limit(100)
    )).all()
    return [{
        "id": attempt.id, "test_title": variant.title, "variant_number": variant.variant_number,
        "status": attempt.status, "percentage": float(attempt.percentage or 0),
        "started_at": attempt.started_at, "submitted_at": attempt.submitted_at,
        "proctored": attempt.exam_session_id is not None,
    } for attempt, variant in rows]



# --- Results & writing review ---------------------------------------------
# The examiner sees every answer of every student in the exams they ran:
# which questions were right, and how the AI graded each writing. Teachers
# can still change a writing grade at any time from the monitor panel; this
# view always shows the current grade and who gave it.

def writing_status(answer: AttemptAnswer | None) -> str:
    if answer is None or answer.is_correct is None:
        return "awaiting"
    return "ai_graded" if answer.graded_by is None else "teacher_graded"


def _answer_present(answer: AttemptAnswer | None) -> bool:
    if answer is None or answer.student_answer is None:
        return False
    value = answer.student_answer
    return not (isinstance(value, str) and not value.strip()) and value != [] and value != {}


@router.get("/examiner/sessions/{session_id}/results")
async def session_results(session_id: uuid.UUID, user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db)):
    session = await owned_session(db, user, session_id)
    meta = (await variant_meta(db, {session.test_variant_id})).get(session.test_variant_id, {})
    rows = (await db.execute(
        select(ExamSessionParticipant, User, Attempt)
        .join(User, User.id == ExamSessionParticipant.user_id)
        .join(Attempt, Attempt.id == ExamSessionParticipant.attempt_id)
        .where(ExamSessionParticipant.session_id == session.id)
        .order_by(User.first_name, User.last_name)
    )).all()
    attempt_ids = [attempt.id for _, _, attempt in rows]
    stats: dict[uuid.UUID, dict] = {
        attempt_id: {"correct": 0, "incorrect": 0, "pending": 0, "writing_total": 0, "writing_ai": 0,
                     "writing_teacher": 0, "writing_awaiting": 0, "writing_points": 0.0, "writing_max": 0.0}
        for attempt_id in attempt_ids
    }
    if attempt_ids:
        for answer, question, task in (await db.execute(
            select(AttemptAnswer, Question, Task)
            .join(Question, Question.id == AttemptAnswer.question_id)
            .join(Task, Task.id == Question.task_id)
            .where(AttemptAnswer.attempt_id.in_(attempt_ids), Question.is_example.is_(False))
        )).all():
            bucket = stats[answer.attempt_id]
            if answer.is_correct is True:
                bucket["correct"] += 1
            elif answer.is_correct is False:
                bucket["incorrect"] += 1
            else:
                bucket["pending"] += 1
            if task.type in MANUAL_TASK_TYPES and _answer_present(answer):
                bucket["writing_total"] += 1
                bucket["writing_max"] += float(question.points)
                bucket["writing_points"] += float(answer.points_awarded or 0)
                bucket[{"awaiting": "writing_awaiting", "ai_graded": "writing_ai",
                        "teacher_graded": "writing_teacher"}[writing_status(answer)]] += 1
    return {
        "id": session.id, "title": session.title or meta.get("test_title", ""), "code": session.code,
        "status": session.status, "created_at": session.created_at, **meta,
        "students": [{
            "participant_id": participant.id, "user_id": student.id, "attempt_id": attempt.id,
            "first_name": student.first_name, "last_name": student.last_name,
            "phone_number": student.phone_number, "username": student.username,
            "exam_mode": student.exam_mode_enabled is not False,
            "status": attempt.status, "removed": participant.status != ParticipantStatus.APPROVED.value,
            "score": float(attempt.total_score or 0), "max_score": float(attempt.max_score or 0),
            "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
            "submitted_at": attempt.submitted_at, "time_spent_seconds": attempt.time_spent_seconds or 0,
            "violations": attempt.violation_count or 0, "max_violations": MAX_EXAM_VIOLATIONS,
            **stats[attempt.id],
        } for participant, student, attempt in rows],
    }


@router.get("/examiner/attempts/{attempt_id}/review")
async def attempt_review(attempt_id: uuid.UUID, user: User = Depends(require_examiner), db: AsyncSession = Depends(get_db)):
    attempt = await db.get(Attempt, attempt_id)
    if not attempt or attempt.exam_session_id is None:
        raise HTTPException(404, "Natija topilmadi.")
    session = await owned_session(db, user, attempt.exam_session_id)
    student = await db.get(User, attempt.user_id)
    variant = await db.get(TestVariant, attempt.test_variant_id)
    answers = {row.question_id: row for row in (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id)
    )).scalars().all()}
    graders = {}
    grader_ids = {row.graded_by for row in answers.values() if row.graded_by}
    if grader_ids:
        graders = {row.id: f"{row.first_name} {row.last_name}" for row in (await db.execute(
            select(User).where(User.id.in_(grader_ids))
        )).scalars().all()}
    submitted = attempt.status != AttemptStatus.IN_PROGRESS
    sections = []
    for section in await attempt_sections(db, attempt):
        tasks = []
        for task in section.tasks:
            manual = task.type in MANUAL_TASK_TYPES
            questions = []
            for question in task.questions:
                if question.is_example:
                    continue
                # A submitted attempt stores one answer row per question it
                # actually contained — anything else was added afterwards.
                if submitted and question.id not in answers:
                    continue
                answer = answers.get(question.id)
                questions.append({
                    "id": question.id, "prompt": question.prompt, "options": question.options,
                    "student_answer": answer.student_answer if answer else None,
                    "correct_answer": None if manual else question.correct_answer,
                    "is_correct": answer.is_correct if answer else None,
                    "points_awarded": float(answer.points_awarded) if answer and answer.points_awarded is not None else None,
                    "max_points": float(question.points),
                    "feedback": answer.feedback if answer else None,
                    "annotations": ((answer.rubric_scores or {}).get("annotations", []) if answer else []),
                    "status": writing_status(answer) if manual else None,
                    "graded_by_name": graders.get(answer.graded_by) if answer and answer.graded_by else None,
                    "graded_at": answer.graded_at if answer else None,
                })
            if questions:
                tasks.append({
                    "id": task.id, "title": task.title, "type": task.type, "manual": manual,
                    "instructions": task.instructions, "questions": questions,
                })
        if tasks:
            sections.append({"title": section.title, "tasks": tasks})
    return {
        "attempt_id": attempt.id, "session_id": session.id, "session_title": session.title or variant.title,
        "test_title": variant.title, "status": attempt.status,
        "student": {"id": student.id, "first_name": student.first_name, "last_name": student.last_name,
                    "phone_number": student.phone_number, "username": student.username,
                    "exam_mode": student.exam_mode_enabled is not False},
        "score": float(attempt.total_score or 0), "max_score": float(attempt.max_score or 0),
        "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
        "passing_percentage": variant.passing_percentage,
        "started_at": attempt.started_at, "submitted_at": attempt.submitted_at,
        "time_spent_seconds": attempt.time_spent_seconds or 0,
        "violations": attempt.violation_count or 0, "max_violations": MAX_EXAM_VIOLATIONS,
        "sections": sections,
    }
