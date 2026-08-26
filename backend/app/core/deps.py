import uuid

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models import Role, User


async def current_user(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required.")
    try:
        payload = decode_token(access_token)
        user = await db.get(User, uuid.UUID(payload["sub"]))
    except (ValueError, KeyError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    return user


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role not in {Role.ADMIN, Role.SUPER_ADMIN}:
        raise HTTPException(status_code=403, detail="Administrator access required.")
    return user


async def require_super_admin(user: User = Depends(current_user)) -> User:
    if user.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super administrator access required.")
    return user


async def require_teacher(user: User = Depends(current_user)) -> User:
    """Teachers grade writing and view student results (the "monitor" panel);
    admins can do everything a teacher can, so they're allowed through too."""
    if user.role not in {Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN}:
        raise HTTPException(status_code=403, detail="Teacher access required.")
    return user
