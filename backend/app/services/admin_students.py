import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminAuditLog, Role, TelegramLink, User
from app.services.audit import write_audit


async def list_students(db: AsyncSession, search: str = "") -> list[dict]:
    query = select(User).where(User.role == Role.STUDENT)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            User.first_name.ilike(term) | User.last_name.ilike(term) | User.phone_number.ilike(term)
        )
    rows = (await db.execute(query.order_by(User.created_at.desc()).limit(100))).scalars().all()
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "phone_number": row.phone_number, "is_active": row.is_active,
        "telegram_linked": bool(row.telegram_link), "created_at": row.created_at,
    } for row in rows]


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
