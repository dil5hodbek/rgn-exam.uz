import json
import logging
import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
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
from app.services.telegram import TelegramDeliveryError, send_telegram_message
from app.schemas.auth import (
    AuthResponse, BotContact, LoginRequest, OTPRequest, OTPVerify, PasswordChange, PasswordReset,
    ProfileUpdate, RegisterRequest, UserOut,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
NEUTRAL_OTP_MESSAGE = (
    "Open the ExamFlow bot, tap Start, and share your phone number. "
    "If it matches an active account, the bot sends your code right away."
)
logger = logging.getLogger(__name__)


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


async def issue_otp(chat_id: str, phone: str, purpose: str, user_id: str) -> None:
    """Generate a fresh code, deliver it over Telegram, and store its hash so
    verify-otp can check it. Raises TelegramDeliveryError if delivery fails."""
    code = new_otp()
    action = "sign in" if purpose == "login" else "reset your password"
    await send_telegram_message(
        chat_id,
        "🔐 <b>ExamFlow verification code</b>\n\n"
        f"Your code to {action}:\n<code>{code}</code>\n\n"
        "⏱ This code expires in 5 minutes.\n"
        "Never share this code with anyone.",
        parse_mode="HTML",
    )
    async with redis_client() as redis:
        await redis.setex(
            f"otp:{phone}:{purpose}",
            300,
            json.dumps({"hash": hash_otp(code), "attempts": 0, "user_id": user_id}),
        )


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
    if not settings.telegram_bot_token or not settings.telegram_bot_username:
        raise HTTPException(503, "Telegram linking is temporarily unavailable. Please contact support.")
    token = secrets.token_urlsafe(24)
    async with redis_client() as redis:
        await redis.setex(
            f"telegram-link:{token}",
            600,
            json.dumps({"user_id": str(user.id), "phone": user.phone_number}),
        )
    return {
        "token": token,
        "deep_link": f"https://t.me/{settings.telegram_bot_username.lstrip('@')}?start=link_{token}",
        "expires_in": 600,
    }


@router.post("/telegram/link/complete")
async def telegram_link_complete(token: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    async with redis_client() as redis:
        pending = await redis.get(f"telegram-link:{token}")
        contact = await redis.get(f"telegram-contact:{token}")
    if not pending or not contact:
        raise HTTPException(409, "Waiting for contact confirmation in Telegram.")
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
    async with redis_client() as redis:
        await redis.delete(f"telegram-link:{token}", f"telegram-contact:{token}")
    try:
        await send_telegram_message(
            chat_id,
            "✅ <b>Telegram connected successfully!</b>\n\n"
            "You can now receive ExamFlow sign-in and password recovery codes in this chat.",
            parse_mode="HTML",
        )
    except TelegramDeliveryError:
        logger.warning("Telegram link saved, but confirmation delivery failed.", exc_info=True)
    return {"linked": True, "message": "Telegram connected successfully."}


@router.post("/telegram/request-otp")
async def request_otp(payload: OTPRequest, request: Request):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError:
        phone = payload.phone_number
    ip = request.client.host if request.client else "unknown"
    rate_key = f"otp-rate:{ip}:{hash_otp(phone)}"
    async with redis_client() as redis:
        count = await redis.incr(rate_key)
        if count == 1:
            await redis.expire(rate_key, 3600)
        if count > 5:
            raise HTTPException(429, "Too many requests. Please try again in one hour.")
        cooldown_key = f"otp-cooldown:{hash_otp(phone)}:{payload.purpose}"
        if not await redis.set(cooldown_key, "1", ex=60, nx=True):
            raise HTTPException(429, "Please wait 60 seconds before requesting another code.")
        # Record the pending request so that, if the account is not linked yet,
        # sharing the phone in the bot completes it and delivers this code.
        await redis.setex(f"otp-pending:{phone}", 600, payload.purpose)
    async with SessionLocal() as db:
        user = await db.scalar(
            select(User).where(User.phone_number == phone).options(selectinload(User.telegram_link))
        )
        # Already linked → deliver immediately and clear the pending marker.
        if user and user.telegram_link and settings.telegram_bot_token:
            try:
                await issue_otp(user.telegram_link.chat_id, phone, payload.purpose, str(user.id))
                async with redis_client() as redis:
                    await redis.delete(f"otp-pending:{phone}")
            except TelegramDeliveryError:
                logger.exception("Telegram OTP delivery failed.")
    return {
        "message": NEUTRAL_OTP_MESSAGE,
        "resend_after": 60,
        "bot_url": (
            f"https://t.me/{settings.telegram_bot_username.lstrip('@')}"
            if settings.telegram_bot_username
            else None
        ),
    }


@router.post("/telegram/bot-contact")
async def telegram_bot_contact(
    payload: BotContact,
    x_bot_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Internal endpoint the bot calls after a user shares their phone. It matches
    the Telegram-verified number to an account, links it automatically, and — if a
    code was requested on the web — issues that code. Guarded by a shared secret
    (the bot token) so only the bot can call it."""
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    try:
        phone = normalize_phone(payload.phone)
    except ValueError:
        return {"matched": False, "reason": "bad_phone"}
    user = await db.scalar(
        select(User).where(User.phone_number == phone).options(selectinload(User.telegram_link))
    )
    if not user or not user.is_active:
        return {"matched": False, "reason": "no_account"}
    conflict = await db.scalar(select(TelegramLink).where(
        TelegramLink.user_id != user.id,
        or_(
            TelegramLink.chat_id == payload.chat_id,
            TelegramLink.telegram_user_id == payload.telegram_user_id,
        ),
    ))
    if conflict:
        return {"matched": False, "reason": "conflict"}
    if user.telegram_link:
        user.telegram_link.chat_id = payload.chat_id
        user.telegram_link.telegram_user_id = payload.telegram_user_id
        user.telegram_link.verified_phone = phone
    else:
        db.add(TelegramLink(
            user_id=user.id, chat_id=payload.chat_id,
            telegram_user_id=payload.telegram_user_id, verified_phone=phone,
        ))
    await db.commit()

    async with redis_client() as redis:
        purpose = await redis.get(f"otp-pending:{phone}")
    code_sent = False
    if purpose:
        try:
            await issue_otp(payload.chat_id, phone, purpose, str(user.id))
            code_sent = True
            async with redis_client() as redis:
                await redis.delete(f"otp-pending:{phone}")
        except TelegramDeliveryError:
            logger.exception("bot-contact OTP delivery failed.")
    return {"matched": True, "code_sent": code_sent}


@router.post("/telegram/verify-otp")
async def verify_otp(payload: OTPVerify, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(401, "Invalid or expired verification code.") from exc
    key = f"otp:{phone}:{payload.purpose}"
    async with redis_client() as redis:
        raw = await redis.get(key)
    if not raw:
        raise HTTPException(401, "Code not found or expired. Request a new code and share your phone in the ExamFlow bot.")
    data = json.loads(raw)
    data["attempts"] += 1
    if data["attempts"] > 5:
        async with redis_client() as redis:
            await redis.delete(key)
        raise HTTPException(429, "This code is no longer valid. Request a new one.")
    if not secrets.compare_digest(data["hash"], hash_otp(payload.code)):
        async with redis_client() as redis:
            ttl = await redis.ttl(key)
            if ttl > 0:
                await redis.setex(key, ttl, json.dumps(data))
        raise HTTPException(401, "Incorrect code. Check the latest message from the ExamFlow bot.")
    user = await db.get(User, uuid.UUID(data["user_id"]))
    if not user or not user.is_active:
        raise HTTPException(401, "Invalid or expired verification code.")
    async with redis_client() as redis:
        await redis.delete(key)
    if payload.purpose == "reset":
        reset_token = secrets.token_urlsafe(32)
        async with redis_client() as redis:
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
    async with redis_client() as redis:
        user_id = await redis.get(f"password-reset:{payload.reset_token}")
    if not user_id:
        raise HTTPException(401, "This password reset session is invalid or expired.")
    user = await db.get(User, uuid.UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(401, "This password reset session is invalid or expired.")
    user.password_hash = hash_password(payload.password)
    await db.commit()
    async with redis_client() as redis:
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
