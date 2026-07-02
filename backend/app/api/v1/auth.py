import json
import logging
import secrets
import uuid
from datetime import timedelta

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from redis.asyncio import Redis
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.deps import current_user
from app.core.security import (
    create_token, decode_token, hash_otp, hash_password, new_otp, normalize_phone, verify_password,
)
from app.models import TelegramLink, User
from app.schemas.auth import (
    AuthResponse, LoginRequest, OTPRequest, OTPVerify, PasswordChange, PasswordReset,
    ProfileUpdate, RegisterRequest, UserOut,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
NEUTRAL_OTP_MESSAGE = "If this phone number is registered and linked to Telegram, we've sent a verification code."
logger = logging.getLogger(__name__)


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


def user_output(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        phone_number=user.phone_number,
        role=user.role,
        theme=user.theme,
        telegram_linked=bool(user.telegram_link),
    )


def set_session(response: Response, user_id: str) -> None:
    access = create_token(user_id, "access", timedelta(minutes=settings.access_token_minutes))
    refresh = create_token(user_id, "refresh", timedelta(days=settings.refresh_token_days))
    common = dict(httponly=True, secure=settings.cookie_secure, samesite="lax", path="/")
    response.set_cookie("access_token", access, max_age=settings.access_token_minutes * 60, **common)
    response.set_cookie("refresh_token", refresh, max_age=settings.refresh_token_days * 86400, **common)


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(payload: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if await db.scalar(select(User).where(User.phone_number == phone)):
        raise HTTPException(409, "An account with this phone number already exists.")
    user = User(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        phone_number=phone,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    set_session(response, str(user.id))
    return AuthResponse(user=user_output(user), message="Your account is ready.")


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError:
        phone = ""
    user = await db.scalar(select(User).where(User.phone_number == phone))
    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        raise HTTPException(401, "Incorrect phone number or password.")
    set_session(response, str(user.id))
    return AuthResponse(user=user_output(user))


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


@router.post("/refresh", response_model=AuthResponse)
async def refresh_session(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not refresh_token:
        raise HTTPException(401, "Refresh session required.")
    try:
        payload = decode_token(refresh_token, "refresh")
        user = await db.scalar(
            select(User).where(User.id == payload["sub"]).options(selectinload(User.telegram_link))
        )
    except (ValueError, KeyError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(401, "Session expired.")
    set_session(response, str(user.id))
    return AuthResponse(user=user_output(user), message="Session refreshed.")


@router.post("/telegram/link/start")
async def telegram_link_start(user: User = Depends(current_user)):
    token = secrets.token_urlsafe(24)
    redis = redis_client()
    await redis.setex(f"telegram-link:{token}", 600, json.dumps({"user_id": str(user.id), "phone": user.phone_number}))
    return {
        "token": token,
        "deep_link": f"https://t.me/{settings.telegram_bot_username}?start=link_{token}",
        "expires_in": 600,
    }


@router.post("/telegram/link/complete")
async def telegram_link_complete(token: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    redis = redis_client()
    pending = await redis.get(f"telegram-link:{token}")
    contact = await redis.lpop(f"telegram-contact:{token}")
    if not pending or not contact:
        raise HTTPException(409, "Telegram verification is not complete yet.")
    request_data = json.loads(pending)
    chat_id, telegram_user_id, raw_phone = contact.split("|", 2)
    try:
        verified_phone = normalize_phone(raw_phone)
    except ValueError as exc:
        raise HTTPException(422, "Telegram returned an unsupported phone number.") from exc
    if request_data["user_id"] != str(user.id) or verified_phone != user.phone_number:
        raise HTTPException(403, "The Telegram phone number does not match this account.")
    conflict = await db.scalar(select(TelegramLink).where(
        TelegramLink.user_id != user.id,
        or_(
            TelegramLink.chat_id == chat_id,
            TelegramLink.telegram_user_id == telegram_user_id,
        ),
    ))
    if conflict:
        raise HTTPException(409, "This Telegram account is already linked to another ExamFlow account.")
    existing = await db.scalar(select(TelegramLink).where(TelegramLink.user_id == user.id))
    if existing:
        existing.chat_id, existing.telegram_user_id, existing.verified_phone = chat_id, telegram_user_id, verified_phone
    else:
        db.add(TelegramLink(user_id=user.id, chat_id=chat_id, telegram_user_id=telegram_user_id, verified_phone=verified_phone))
    await db.commit()
    await redis.delete(f"telegram-link:{token}")
    return {"linked": True}


@router.post("/telegram/request-otp")
async def request_otp(payload: OTPRequest, request: Request):
    redis = redis_client()
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError:
        phone = payload.phone_number
    ip = request.client.host if request.client else "unknown"
    rate_key = f"otp-rate:{ip}:{hash_otp(phone)}"
    count = await redis.incr(rate_key)
    if count == 1:
        await redis.expire(rate_key, 3600)
    if count > 5:
        raise HTTPException(429, "Too many requests. Please try again later.")
    cooldown_key = f"otp-cooldown:{hash_otp(phone)}:{payload.purpose}"
    if not await redis.set(cooldown_key, "1", ex=60, nx=True):
        raise HTTPException(429, "Please wait before requesting another code.")
    async with SessionLocal() as db:
        user = await db.scalar(
            select(User).where(User.phone_number == phone).options(selectinload(User.telegram_link))
        )
        if user and user.telegram_link and settings.telegram_bot_token:
            code = new_otp()
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    telegram_response = await client.post(
                        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                        json={
                            "chat_id": user.telegram_link.chat_id,
                            "text": f"Your ExamFlow verification code is {code}. It expires in 5 minutes.",
                        },
                    )
                    telegram_response.raise_for_status()
                    if not telegram_response.json().get("ok"):
                        raise RuntimeError("Telegram rejected the verification message.")
                await redis.setex(
                    f"otp:{phone}:{payload.purpose}", 300,
                    json.dumps({"hash": hash_otp(code), "attempts": 0, "user_id": str(user.id)}),
                )
            except (httpx.HTTPError, RuntimeError, ValueError):
                logger.exception("Telegram OTP delivery failed.")
    return {"message": NEUTRAL_OTP_MESSAGE, "resend_after": 60}


@router.post("/telegram/verify-otp")
async def verify_otp(payload: OTPVerify, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(401, "Invalid or expired verification code.") from exc
    redis = redis_client()
    key = f"otp:{phone}:{payload.purpose}"
    raw = await redis.get(key)
    if not raw:
        raise HTTPException(401, "Invalid or expired verification code.")
    data = json.loads(raw)
    data["attempts"] += 1
    if data["attempts"] > 5:
        await redis.delete(key)
        raise HTTPException(429, "This code is no longer valid. Request a new one.")
    if not secrets.compare_digest(data["hash"], hash_otp(payload.code)):
        ttl = await redis.ttl(key)
        if ttl > 0:
            await redis.setex(key, ttl, json.dumps(data))
        raise HTTPException(401, "Invalid or expired verification code.")
    user = await db.get(User, uuid.UUID(data["user_id"]))
    if not user or not user.is_active:
        raise HTTPException(401, "Invalid or expired verification code.")
    await redis.delete(key)
    if payload.purpose == "reset":
        reset_token = secrets.token_urlsafe(32)
        await redis.setex(f"password-reset:{reset_token}", 600, str(user.id))
        return {
            "message": "Verification successful. Set a new password.",
            "reset_token": reset_token,
            "expires_in": 600,
        }
    set_session(response, str(user.id))
    return AuthResponse(user=user_output(user), message="Telegram verification successful.")


@router.post("/forgot-password/reset")
async def reset_password(payload: PasswordReset, db: AsyncSession = Depends(get_db)):
    redis = redis_client()
    user_id = await redis.get(f"password-reset:{payload.reset_token}")
    if not user_id:
        raise HTTPException(401, "This password reset session is invalid or expired.")
    user = await db.get(User, uuid.UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(401, "This password reset session is invalid or expired.")
    user.password_hash = hash_password(payload.password)
    await db.commit()
    await redis.delete(f"password-reset:{payload.reset_token}")
    return {"message": "Password updated. You can now sign in."}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user_output(user)


@router.patch("/me", response_model=UserOut)
async def update_me(payload: ProfileUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user.first_name = payload.first_name.strip()
    user.last_name = payload.last_name.strip()
    user.theme = payload.theme
    await db.commit()
    await db.refresh(user)
    return user_output(user)


@router.post("/me/password")
async def change_password(
    payload: PasswordChange,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password changed successfully."}


@router.delete("/telegram/link", status_code=204)
async def unlink_telegram(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    link = await db.scalar(select(TelegramLink).where(TelegramLink.user_id == user.id))
    if link:
        await db.delete(link)
        await db.commit()
