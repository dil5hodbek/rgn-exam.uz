import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, UploadFile
from redis.asyncio import Redis
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.deps import current_user
from app.core.security import (
    create_token, decode_token, hash_otp, hash_password, hash_value, new_otp, normalize_phone,
    verify_password,
)
from app.models import Attempt, Role, TelegramLink, User
from app.services.admin_media import save_avatar_upload
from app.services.telegram import TelegramDeliveryError, send_telegram_message
from app.schemas.auth import (
    AuthResponse, BotContact, BotStart, TelegramMagicLogin, TelegramBotRegister, TelegramBotReset, LoginRequest, OTPRequest, OTPVerify, PasswordChange,
    PasswordReset, ProfileUpdate, RegisterRequest, UserOut,
)

from app.services.magic_login import MAGIC_LINK_TTL, redeem_magic_token, issue_magic_token

router = APIRouter(prefix="/auth", tags=["Authentication"])
NEUTRAL_OTP_MESSAGE = (
    "Open the Registon bot, tap Start, and share your phone number. "
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
        "🔐 <b>Registon verification code</b>\n\n"
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
        avatar_url=user.avatar_url,
        telegram_linked=bool(user.telegram_link),
    )


def set_session(response: Response, user_id: str, *, session_until: int | None = None) -> None:
    access_seconds = settings.access_token_minutes * 60
    refresh_seconds = settings.refresh_token_days * 86400
    if session_until is not None:
        remaining = session_until - int(datetime.now(timezone.utc).timestamp())
        if remaining <= 0:
            raise HTTPException(401, "Session expired. Request a new link in Telegram.")
        access_seconds = refresh_seconds = remaining
    access = create_token(user_id, "access", timedelta(seconds=access_seconds), session_until=session_until)
    refresh = create_token(user_id, "refresh", timedelta(seconds=refresh_seconds), session_until=session_until)
    common = dict(httponly=True, secure=settings.cookie_secure, samesite="lax", path="/")
    response.set_cookie("access_token", access, max_age=access_seconds, **common)
    response.set_cookie("refresh_token", refresh, max_age=refresh_seconds, **common)


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
async def login(payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError:
        phone = ""
    # Brute-force guard: 10 failed tries per phone+IP within 15 minutes.
    client_ip = request.client.host if request.client else "unknown"
    fails_key = f"login-fails:{phone or 'invalid'}:{client_ip}"
    async with redis_client() as redis:
        if int(await redis.get(fails_key) or 0) >= 10:
            raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    user = await db.scalar(select(User).where(User.phone_number == phone))
    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        async with redis_client() as redis:
            fails = await redis.incr(fails_key)
            if fails == 1:
                await redis.expire(fails_key, 900)
        raise HTTPException(401, "Incorrect phone number or password.")
    async with redis_client() as redis:
        await redis.delete(fails_key)
    set_session(response, str(user.id))
    return AuthResponse(user=user_output(user))


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("telegram_browser", path="/")


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
    set_session(response, str(user.id), session_until=payload.get("session_until"))
    return AuthResponse(user=user_output(user), message="Session refreshed.")


@router.post("/telegram/sign-in/start")
async def telegram_sign_in_start():
    if not settings.telegram_bot_token or not settings.telegram_bot_username:
        raise HTTPException(503, "Telegram sign-in is not configured. Please contact support.")
    return {"bot_url": f"https://t.me/{settings.telegram_bot_username.lstrip('@')}?start=signin"}


@router.post("/telegram/bot-sign-in")
async def telegram_bot_sign_in(
    payload: BotStart, x_bot_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    link = await db.scalar(select(TelegramLink).where(
        TelegramLink.telegram_user_id == payload.telegram_user_id,
        TelegramLink.chat_id == payload.chat_id,
    ))
    if not link:
        return {"linked": False}
    user = await db.get(User, link.user_id)
    if not user or not user.is_active:
        return {"linked": False}
    async with redis_client() as redis:
        if not await redis.set(f"telegram-signin-rate:{user.id}", "1", ex=30, nx=True):
            raise HTTPException(429, "Please wait 30 seconds before requesting another sign-in link.")
        token = await issue_magic_token(redis, str(user.id))
    # A fragment stays in the browser; it is not sent in request/access logs.
    return {
        "linked": True,
        "sign_in_url": f"{settings.frontend_url.rstrip('/')}/telegram-sign-in#token={token}",
        "expires_in": MAGIC_LINK_TTL,
    }


@router.post("/telegram/bot-register", status_code=201)
async def telegram_bot_register(
    payload: TelegramBotRegister, x_bot_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    first_name, last_name = payload.first_name.strip(), payload.last_name.strip()
    if not first_name:
        raise HTTPException(422, "Telegram profile name is required.")
    async with redis_client() as redis:
        raw = await redis.getdel(f"telegram-register-contact:{payload.telegram_user_id}")
    if not raw:
        raise HTTPException(409, "Contact verification expired. Share your contact again.")
    proof = json.loads(raw)
    if proof["chat_id"] != payload.chat_id:
        raise HTTPException(403, "Contact verification does not match this chat.")
    phone = proof["phone"]
    existing = await db.scalar(select(User).where(User.phone_number == phone))
    linked = await db.scalar(select(TelegramLink).where(or_(
        TelegramLink.telegram_user_id == payload.telegram_user_id,
        TelegramLink.chat_id == payload.chat_id,
    )))
    if existing or linked:
        raise HTTPException(409, "An account already exists. Tap /start to sign in.")
    # Telegram-only signup uses an unguessable password. Password recovery can
    # subsequently set a password if the student wants password-based access.
    user = User(first_name=first_name, last_name=last_name, phone_number=phone,
                password_hash=hash_password(secrets.token_urlsafe(32)))
    db.add(user)
    try:
        await db.flush()
        db.add(TelegramLink(user_id=user.id, chat_id=payload.chat_id,
                           telegram_user_id=payload.telegram_user_id, verified_phone=phone))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "An account already exists. Tap /start to sign in.")
    return {"registered": True}


def reset_confirmation_key(payload: BotStart, token: str) -> str:
    return f"telegram-account-reset:{payload.telegram_user_id}:{payload.chat_id}:{hash_value(token)}"


@router.post("/telegram/bot-reset/start")
async def telegram_bot_reset_start(
    payload: BotStart, x_bot_secret: str = Header(default=""), db: AsyncSession = Depends(get_db),
):
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    link = await db.scalar(select(TelegramLink).where(
        TelegramLink.telegram_user_id == payload.telegram_user_id, TelegramLink.chat_id == payload.chat_id,
    ))
    if not link:
        return {"registered": False}
    user = await db.get(User, link.user_id)
    if not user or user.role != Role.STUDENT:
        raise HTTPException(403, "Only student accounts can be reset through this bot.")
    token = secrets.token_urlsafe(16)
    async with redis_client() as redis:
        await redis.set(reset_confirmation_key(payload, token), str(user.id), ex=120)
    return {"registered": True, "confirmation_token": token, "expires_in": 120}


@router.post("/telegram/bot-reset/cancel")
async def telegram_bot_reset_cancel(payload: TelegramBotReset, x_bot_secret: str = Header(default="")):
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    async with redis_client() as redis:
        await redis.getdel(reset_confirmation_key(payload, payload.confirmation_token))
    return {"cancelled": True}


@router.post("/telegram/bot-reset/complete")
async def telegram_bot_reset_complete(
    payload: TelegramBotReset, x_bot_secret: str = Header(default=""), db: AsyncSession = Depends(get_db),
):
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    async with redis_client() as redis:
        user_id = await redis.getdel(reset_confirmation_key(payload, payload.confirmation_token))
    if not user_id:
        raise HTTPException(409, "Confirmation expired. Send /resetaccount again.")
    link = await db.scalar(select(TelegramLink).where(
        TelegramLink.telegram_user_id == payload.telegram_user_id,
        TelegramLink.chat_id == payload.chat_id, TelegramLink.user_id == uuid.UUID(user_id),
    ))
    if not link:
        raise HTTPException(409, "Account changed. Send /resetaccount again.")
    user = await db.scalar(select(User).where(User.id == link.user_id).with_for_update())
    if not user or user.role != Role.STUDENT:
        raise HTTPException(403, "Only student accounts can be reset through this bot.")
    phone = user.phone_number
    avatar_url = user.avatar_url
    attempt_ids = list((await db.scalars(select(Attempt.id).where(Attempt.user_id == user.id))).all())
    try:
        await db.execute(delete(Attempt).where(Attempt.user_id == user.id))
        await db.delete(user)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This account has administrative records. Contact an administrator.")
    async with redis_client() as redis:
        keys = [f"telegram-registration:{payload.telegram_user_id}",
                f"telegram-register-contact:{payload.telegram_user_id}",
                f"telegram-pending:{payload.telegram_user_id}",
                f"telegram-signin-pending:{payload.telegram_user_id}",
                f"telegram-signin-rate:{user_id}", f"otp-pending:{phone}",
                f"otp:{phone}:login", f"otp:{phone}:reset"]
        for attempt_id in attempt_ids:
            keys.extend([f"attempt-paused:{attempt_id}", f"attempt-checked:{attempt_id}"])
        await redis.delete(*keys)
    if avatar_url and avatar_url.startswith("/media/"):
        avatar_path = (settings.storage_path / avatar_url[len("/media/"):]).resolve()
        if avatar_path.is_relative_to(settings.storage_path.resolve()):
            try:
                avatar_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove an avatar file after account reset.")
    return {"reset": True}


@router.post("/telegram/sign-in/browser", status_code=204)
async def prepare_telegram_browser(request: Request, response: Response):
    browser_secret = request.cookies.get("telegram_browser") or secrets.token_urlsafe(32)
    response.set_cookie("telegram_browser", browser_secret, max_age=MAGIC_LINK_TTL,
                        httponly=True, secure=settings.cookie_secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"


@router.post("/telegram/sign-in/complete", response_model=AuthResponse)
async def telegram_sign_in_complete(
    payload: TelegramMagicLogin, request: Request, response: Response, db: AsyncSession = Depends(get_db),
):
    browser_secret = request.cookies.get("telegram_browser") or secrets.token_urlsafe(32)
    current_user_id = ""
    for name, kind in (("access_token", "access"), ("refresh_token", "refresh")):
        raw = request.cookies.get(name)
        if raw:
            try:
                subject = decode_token(raw, kind)["sub"]
                account = await db.get(User, uuid.UUID(subject))
                if account and account.is_active:
                    current_user_id = subject
                    break
            except (ValueError, KeyError):
                continue
    async with redis_client() as redis:
        redemption = await redeem_magic_token(redis, payload.token, browser_secret, current_user_id)
    if not redemption:
        raise HTTPException(401, "Link expired or belongs to another browser/account. Request a new link in Telegram.")
    user = await db.get(User, uuid.UUID(redemption["user_id"]))
    if not user or not user.is_active:
        raise HTTPException(401, "This account is unavailable.")
    set_session(response, str(user.id), session_until=redemption["session_until"])
    response.set_cookie("telegram_browser", browser_secret, max_age=redemption["seconds_remaining"],
                        httponly=True, secure=settings.cookie_secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return AuthResponse(user=user_output(user), message="Signed in through Telegram.")


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
        raise HTTPException(409, "This Telegram account is already linked to another Registon account.")
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
            "You can now receive Registon sign-in and password recovery codes in this chat.",
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
    rate_key = f"otp-rate:{ip}:{hash_value(phone)}"
    async with redis_client() as redis:
        count = await redis.incr(rate_key)
        if count == 1:
            await redis.expire(rate_key, 3600)
        if count > 5:
            raise HTTPException(429, "Too many requests. Please try again in one hour.")
        cooldown_key = f"otp-cooldown:{hash_value(phone)}:{payload.purpose}"
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


@router.post("/telegram/bot-start")
async def telegram_bot_start(
    payload: BotStart,
    x_bot_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Called by the bot on a plain /start (no deep-link). If this chat is
    already linked to an account, send a sign-in code immediately instead of
    asking the user to re-share their phone. Guarded by the same shared
    secret as bot-contact."""
    if not settings.telegram_bot_token or not secrets.compare_digest(x_bot_secret, settings.telegram_bot_token):
        raise HTTPException(403, "Forbidden.")
    link = await db.scalar(
        select(TelegramLink).where(TelegramLink.telegram_user_id == payload.telegram_user_id)
    )
    if not link:
        return {"linked": False}
    user = await db.get(User, link.user_id)
    if not user or not user.is_active:
        return {"linked": False}
    cooldown_key = f"otp-cooldown:{hash_value(user.phone_number)}:login"
    async with redis_client() as redis:
        if not await redis.set(cooldown_key, "1", ex=60, nx=True):
            return {"linked": True, "code_sent": False}
    try:
        await issue_otp(link.chat_id, user.phone_number, "login", str(user.id))
    except TelegramDeliveryError:
        logger.exception("bot-start OTP delivery failed.")
        return {"linked": True, "code_sent": False}
    return {"linked": True, "code_sent": True}


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
    if not user:
        # Proof comes only from the bot's native self-contact handler, never
        # from a phone number typed into a web form or a name message.
        async with redis_client() as redis:
            await redis.setex(f"telegram-register-contact:{payload.telegram_user_id}", 600,
                             json.dumps({"phone": phone, "chat_id": payload.chat_id}))
        return {"matched": False, "reason": "no_account"}
    if not user.is_active:
        return {"matched": False, "reason": "inactive"}
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
        raise HTTPException(401, "Code not found or expired. Request a new code and share your phone in the Registon bot.")
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
        raise HTTPException(401, "Incorrect code. Check the latest message from the Registon bot.")
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


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile, user: User = Depends(current_user), db: AsyncSession = Depends(get_db),
):
    previous_url = user.avatar_url
    user.avatar_url = await save_avatar_upload(file)
    await db.commit()
    await db.refresh(user)
    if previous_url:
        (settings.storage_path / Path(previous_url).relative_to("/media")).unlink(missing_ok=True)
    return user_output(user)


@router.delete("/me/avatar", response_model=UserOut)
async def delete_avatar(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user.avatar_url:
        (settings.storage_path / Path(user.avatar_url).relative_to("/media")).unlink(missing_ok=True)
        user.avatar_url = None
        await db.commit()
        await db.refresh(user)
    return user_output(user)


@router.delete("/telegram/link", status_code=204)
async def unlink_telegram(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    link = await db.scalar(select(TelegramLink).where(TelegramLink.user_id == user.id))
    if link:
        await db.delete(link)
        await db.commit()
