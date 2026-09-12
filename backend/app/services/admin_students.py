import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AdminAuditLog, Attempt, AttemptStatus, ExamType, Level, Role, TelegramLink, TestVariant, User,
)
from app.services.audit import write_audit


async def list_students(db: AsyncSession, search: str = "") -> list[dict]:
    query = select(User).where(User.role == Role.STUDENT)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            User.first_name.ilike(term) | User.last_name.ilike(term) | User.phone_number.ilike(term)
        )
    rows = (await db.execute(query.order_by(User.created_at.desc()).limit(100))).scalars().all()
    if not rows:
        return []
    # Only completed attempts count toward the summary — an abandoned
    # IN_PROGRESS attempt isn't a "result" yet.
    stats_rows = (await db.execute(
        select(
            Attempt.user_id, func.count(Attempt.id), func.avg(Attempt.percentage),
        )
        .where(Attempt.user_id.in_([row.id for row in rows]), Attempt.status != AttemptStatus.IN_PROGRESS)
        .group_by(Attempt.user_id)
    )).all()
    stats_map = {user_id: (count, avg) for user_id, count, avg in stats_rows}
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "phone_number": row.phone_number, "is_active": row.is_active,
        "telegram_linked": bool(row.telegram_link), "created_at": row.created_at,
        "total_attempts": stats_map.get(row.id, (0, None))[0],
        "average_percentage": (
            round(float(stats_map[row.id][1]), 1) if row.id in stats_map and stats_map[row.id][1] is not None else None
        ),
    } for row in rows]


async def student_attempts(db: AsyncSession, student_id: uuid.UUID) -> dict:
    """Every completed attempt for this student, newest first — each retake
    or shuffled ("random test") run is its own Attempt row, so restarts and
    repeats all show up separately rather than being collapsed into one."""
    student = await db.get(User, student_id)
    if not student or student.role != Role.STUDENT:
        raise HTTPException(404, "Student not found.")
    rows = (await db.execute(
        select(Attempt, TestVariant, Level, ExamType)
        .join(TestVariant, TestVariant.id == Attempt.test_variant_id)
        .join(Level, Level.id == TestVariant.level_id)
        .join(ExamType, ExamType.id == TestVariant.exam_type_id)
        .where(Attempt.user_id == student_id, Attempt.status != AttemptStatus.IN_PROGRESS)
        .order_by(Attempt.submitted_at.desc().nulls_last(), Attempt.started_at.desc())
    )).all()
    return {
        "student": {
            "id": student.id, "first_name": student.first_name, "last_name": student.last_name,
            "phone_number": student.phone_number,
        },
        "attempts": [{
            "id": attempt.id,
            "title": variant.title,
            "level": level.name,
            "exam_type": exam_type.name,
            "is_mixed": bool(attempt.extra_task_ids),
            "status": attempt.status,
            "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
            "passing_percentage": variant.passing_percentage,
            "passed": (
                float(attempt.percentage) >= variant.passing_percentage if attempt.percentage is not None else False
            ),
            "started_at": attempt.started_at,
            "submitted_at": attempt.submitted_at,
            "time_spent_seconds": attempt.time_spent_seconds,
        } for attempt, variant, level, exam_type in rows],
    }


async def set_student_active(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None,
    student_id: uuid.UUID, active: bool,
) -> dict:
    student = await db.get(User, student_id)
    if not student or student.role != Role.STUDENT:
        raise HTTPException(404, "Student not found.")
    student.is_active = active
    await write_audit(db, admin_id, "student.active", "User", str(student.id), {"active": active}, ip_address)
    await db.commit()
    return {"id": student.id, "is_active": student.is_active}


async def unlink_student_telegram(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, student_id: uuid.UUID,
) -> None:
    link = await db.scalar(select(TelegramLink).where(TelegramLink.user_id == student_id))
    if link:
        await db.delete(link)
    await write_audit(db, admin_id, "student.telegram_unlink", "User", str(student_id), ip_address=ip_address)
    await db.commit()


async def audit_log(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(200)
    )).scalars().all()
    return [{
        "id": row.id, "actor_id": row.actor_id, "action": row.action,
        "entity_type": row.entity_type, "entity_id": row.entity_id,
        "metadata": row.metadata_json, "ip_address": row.ip_address, "created_at": row.created_at,
    } for row in rows]
