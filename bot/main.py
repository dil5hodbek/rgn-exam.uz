import asyncio
import logging
import os

import httpx
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.filters.command import CommandObject
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove
from redis.asyncio import Redis

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
BACKEND_URL = os.getenv("BACKEND_INTERNAL_URL", "http://backend:8000").rstrip("/")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)
dp = Dispatcher()
redis = Redis.from_url(REDIS_URL, decode_responses=True)


def _share_phone_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="📱 Share my phone number", request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


@dp.message(CommandStart(deep_link=True))
async def linked_start(message: Message, command: CommandObject):
    payload = command.args or ""
    if not payload.startswith("link_") or not await redis.exists(f"telegram-link:{payload[5:]}"):
        await message.answer(
            "⏳ This connection link has expired or is invalid.\n\n"
            "Please return to ExamFlow → Settings → Telegram and tap “Link Telegram” again."
        )
        return
    await redis.setex(f"telegram-pending:{message.from_user.id}", 300, payload[5:])
    await message.answer(
        "👋 <b>Let’s connect your ExamFlow account</b>\n\n"
        "Tap the button below to share the phone number verified by Telegram. "
        "For your security, manually typed numbers are not accepted.\n\n"
        "The number must match your ExamFlow account.",
        reply_markup=_share_phone_keyboard(),
        parse_mode="HTML",
    )


@dp.message(CommandStart())
async def start(message: Message):
    await message.answer(
        "👋 <b>Welcome to ExamFlow Bot!</b>\n\n"
        "Tap the button below and share your phone number. "
        "If it matches your ExamFlow account, your verification code is sent here instantly.",
        reply_markup=_share_phone_keyboard(),
        parse_mode="HTML",
    )


async def _handle_shared_contact(message: Message) -> None:
    """Plain /start flow: no pending link token, so ask the backend to match the
    phone, link it automatically, and deliver any code that was requested."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/v1/auth/telegram/bot-contact",
                json={
                    "chat_id": str(message.chat.id),
                    "telegram_user_id": str(message.from_user.id),
                    "phone": message.contact.phone_number,
                },
                headers={"X-Bot-Secret": TOKEN},
            )
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        logger.exception("bot-contact request failed")
        await message.answer(
            "⚠️ Something went wrong. Please try again in a moment.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    if data.get("matched") and data.get("code_sent"):
        await message.answer(
            "✅ <b>Number confirmed!</b>\n\nYour verification code is above — "
            "enter it in ExamFlow to continue.",
            reply_markup=ReplyKeyboardRemove(), parse_mode="HTML",
        )
    elif data.get("matched"):
        await message.answer(
            "✅ <b>Telegram connected!</b>\n\nGo back to ExamFlow and request a code — "
            "it will arrive here.",
            reply_markup=ReplyKeyboardRemove(), parse_mode="HTML",
        )
    elif data.get("reason") == "conflict":
        await message.answer(
            "⚠️ This Telegram account is already linked to a different ExamFlow account.",
            reply_markup=ReplyKeyboardRemove(),
        )
    else:
        await message.answer(
            "⚠️ No active ExamFlow account uses this phone number. "
            "Sign up on ExamFlow first, then try again.",
            reply_markup=ReplyKeyboardRemove(),
        )


@dp.message(F.contact)
async def contact(message: Message):
    if not message.from_user or message.contact.user_id != message.from_user.id:
        await message.answer(
            "⚠️ Please share your own contact using the button provided by the bot.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return
    token = await redis.get(f"telegram-pending:{message.from_user.id}")
    if not token:
        # No Settings deep-link in progress — treat this as the direct code flow.
        await _handle_shared_contact(message)
        return
    await redis.setex(
        f"telegram-contact:{token}",
        300,
        f"{message.chat.id}|{message.from_user.id}|{message.contact.phone_number}",
    )
    await redis.delete(f"telegram-pending:{message.from_user.id}")
    await message.answer(
        "✅ <b>Phone number confirmed!</b>\n\n"
        "Return to ExamFlow. The connection will finish automatically in a few seconds.",
        reply_markup=ReplyKeyboardRemove(),
        parse_mode="HTML",
    )


async def main():
    if not TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN is empty; the bot is idle.")
        while True:
            await asyncio.sleep(3600)
    bot = Bot(TOKEN)
    try:
        identity = await bot.get_me()
        logger.info("ExamFlow bot started as @%s", identity.username)
        await dp.start_polling(bot)
    finally:
        await redis.aclose()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
