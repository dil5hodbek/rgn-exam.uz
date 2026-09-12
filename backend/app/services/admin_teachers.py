import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_phone
from app.models import Role, User
from app.schemas.content import TeacherCreate
from app.services.audit import write_audit


async def list_teachers(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(User).where(User.role == Role.TEACHER).order_by(User.created_at.desc())
    )).scalars().all()
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "phone_number": row.phone_number, "is_active": row.is_active, "created_at": row.created_at,
    } for row in rows]


async def create_teacher(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, payload: TeacherCreate,
) -> dict:
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if await db.scalar(select(User).where(User.phone_number == phone)):
        raise HTTPException(409, "An account with this phone number already exists.")
    teacher = User(
        first_name=payload.first_name.strip(), last_name=payload.last_name.strip(),
        phone_number=phone, password_hash=hash_password(payload.password), role=Role.TEACHER,
    )
    db.add(teacher)
    await write_audit(db, admin_id, "teacher.create", "User", None, {"phone_number": phone}, ip_address)
    await db.commit()
    await db.refresh(teacher)
    return {
        "id": teacher.id, "first_name": teacher.first_name, "last_name": teacher.last_name,
        "phone_number": teacher.phone_number, "is_active": teacher.is_active,
    }


async def set_teacher_active(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, teacher_id: uuid.UUID, active: bool,
) -> dict:
    teacher = await db.get(User, teacher_id)
    if not teacher or teacher.role != Role.TEACHER:
        raise HTTPException(404, "Teacher not found.")
    teacher.is_active = active
    await write_audit(db, admin_id, "teacher.active", "User", str(teacher.id), {"active": active}, ip_address)
    await db.commit()
    return {"id": teacher.id, "is_active": teacher.is_active}
