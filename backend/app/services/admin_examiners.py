import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_phone, normalize_username
from app.models import ExamSession, Role, User
from app.schemas.content import ExaminerCreate
from app.services.audit import write_audit


def _row(user: User, session_count: int = 0) -> dict:
    return {
        "id": user.id, "first_name": user.first_name, "last_name": user.last_name,
        "phone_number": user.phone_number, "username": user.username,
        "is_active": user.is_active, "created_at": user.created_at, "session_count": session_count,
    }


async def list_examiners(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(User).where(User.role == Role.EXAMINER).order_by(User.created_at.desc())
    )).scalars().all()
    counts = dict((await db.execute(
        select(ExamSession.examiner_id, func.count(ExamSession.id)).group_by(ExamSession.examiner_id)
    )).all())
    return [_row(row, counts.get(row.id, 0)) for row in rows]


async def create_examiner(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, payload: ExaminerCreate,
) -> dict:
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if await db.scalar(select(User).where(User.phone_number == phone)):
        raise HTTPException(409, "An account with this phone number already exists.")
    username = None
    if payload.username and payload.username.strip():
        username = normalize_username(payload.username)
        if not username:
            raise HTTPException(422, "Username: 3-32 chars, starts with a letter; letters, digits, . and _ only.")
        if await db.scalar(select(User.id).where(User.username == username)):
            raise HTTPException(409, "This username is already taken.")
    examiner = User(
        first_name=payload.first_name.strip(), last_name=payload.last_name.strip(),
        phone_number=phone, username=username, password_hash=hash_password(payload.password),
        role=Role.EXAMINER,
    )
    db.add(examiner)
    await write_audit(db, admin_id, "examiner.create", "User", None, {"phone_number": phone}, ip_address)
    await db.commit()
    await db.refresh(examiner)
    return _row(examiner)


async def set_examiner_active(
    db: AsyncSession, admin_id: uuid.UUID, ip_address: str | None, examiner_id: uuid.UUID, active: bool,
) -> dict:
    examiner = await db.get(User, examiner_id)
    if not examiner or examiner.role != Role.EXAMINER:
        raise HTTPException(404, "Examiner not found.")
    examiner.is_active = active
    await write_audit(db, admin_id, "examiner.active", "User", str(examiner.id), {"active": active}, ip_address)
    await db.commit()
    return {"id": examiner.id, "is_active": examiner.is_active}
