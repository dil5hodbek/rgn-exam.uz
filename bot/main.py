import asyncio
from pathlib import Path
from dotenv import load_dotenv
import logging
import os

import httpx
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.filters.command import CommandObject
from aiogram.types import BotCommand, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove
from redis.asyncio import Redis

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

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
    if payload in {"signin", "signup"}:
        await start(message)
        return
    if message.chat.type != "private":
        await message.answer("Please open this bot in a private chat.")
        return
    await redis.delete(f"telegram-signin-pending:{message.from_user.id}")
    if not payload.startswith("link_") or not await redis.exists(f"telegram-link:{payload[5:]}"):
        await message.answer(
            "⏳ This connection link has expired or is invalid.\n\n"
            "Please return to Registon → Settings → Telegram and tap “Link Telegram” again."
        )
        return
    await redis.setex(f"telegram-pending:{message.from_user.id}", 600, payload[5:])
    await message.answer(
        "👋 <b>Let’s connect your Registon account</b>\n\n"
        "Tap the button below to share the phone number verified by Telegram. "
        "For your security, manually typed numbers are not accepted.\n\n"
        "The number must match your Registon account.",
        reply_markup=_share_phone_keyboard(),
        parse_mode="HTML",
    )


async def _send_signin_link(message: Message) -> bool:
    """Return False only when contact verification is still required."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/v1/auth/telegram/bot-sign-in",
                json={"chat_id": str(message.chat.id), "telegram_user_id": str(message.from_user.id)},
                headers={"X-Bot-Secret": TOKEN},
            )
            if response.status_code == 429:
                await message.answer("⏳ Please wait 30 seconds, then tap /start for a new sign-in link.")
                return True
            response.raise_for_status()
            data = response.json()
        if not data.get("linked"):
            return False
        await message.answer(
            "🔐 <b>Your personal sign-in link</b>\n\n"
            "Tap the button to open your account. The link is valid for 1 hour. After the first sign-in, the same browser remembers you for 1 hour "
            "and can reopen this link. Other browsers cannot reuse it. Do not share it.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Open my dashboard →", url=data["sign_in_url"]),
            ]]),
        )
        return True
    except (httpx.HTTPError, ValueError, KeyError):
        logger.warning("Could not create or deliver Telegram sign-in link.")
        await message.answer("⚠️ Unable to create your sign-in link. Please try /start again shortly.")
        return True


@dp.message(CommandStart())
async def start(message: Message):
    if message.chat.type != "private":
        await message.answer("Please open this bot in a private chat to sign in.")
        return
    await redis.delete(f"telegram-pending:{message.from_user.id}", f"telegram-registration:{message.from_user.id}")
    if await _send_signin_link(message):
        await redis.delete(f"telegram-signin-pending:{message.from_user.id}")
        return
    await redis.setex(f"telegram-signin-pending:{message.from_user.id}", 600, "1")
    await message.answer(
        "👋 <b>Sign in to Registon</b>\n\n"
        "Share your own phone number using the button below. "
        "Hisobingiz bo‘lsa kirish havolasi beriladi. Hisob bo‘lmasa, shu yerda ro‘yxatdan o‘tasiz.",
        reply_markup=_share_phone_keyboard(), parse_mode="HTML",
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
            "⚠️ Something went wrong on our side. Please tap /start and share your "
            "phone number again in a moment — if it keeps failing, contact support.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    if data.get("matched") and await redis.exists(f"telegram-signin-pending:{message.from_user.id}"):
        await redis.delete(f"telegram-signin-pending:{message.from_user.id}")
        await message.answer("✅ Phone number confirmed.", reply_markup=ReplyKeyboardRemove())
        await _send_signin_link(message)
        return

    if data.get("matched") and data.get("code_sent"):
        await message.answer(
            "✅ <b>Number confirmed!</b>\n\nYour verification code is above — "
            "enter it in Registon to continue.",
            reply_markup=ReplyKeyboardRemove(), parse_mode="HTML",
        )
    elif data.get("matched"):
        await message.answer(
            "✅ <b>Telegram connected!</b>\n\nGo back to Registon and request a code — "
            "it will arrive here.",
            reply_markup=ReplyKeyboardRemove(), parse_mode="HTML",
        )
    elif data.get("reason") == "no_account":
        await _register_from_profile(message)
    elif data.get("reason") == "inactive":
        await message.answer("Bu hisob faol emas. O‘quv markazi administratoriga murojaat qiling.", reply_markup=ReplyKeyboardRemove())
    elif data.get("reason") == "conflict":
        await message.answer(
            "⚠️ This Telegram account is already linked to a different Registon account.",
            reply_markup=ReplyKeyboardRemove(),
        )
    else:
        await message.answer(
            "⚠️ No active Registon account uses this phone number. "
            "Sign up on Registon first, then try again.",
            reply_markup=ReplyKeyboardRemove(),
        )


@dp.message(F.contact)
async def contact(message: Message):
    if message.chat.type != "private" or not message.from_user or message.contact.user_id != message.from_user.id:
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
        600,
        f"{message.chat.id}|{message.from_user.id}|{message.contact.phone_number}",
    )
    await redis.delete(f"telegram-pending:{message.from_user.id}")
    await message.answer(
        "✅ <b>Phone number confirmed!</b>\n\n"
        "Return to Registon. The connection will finish automatically in a few seconds.",
        reply_markup=ReplyKeyboardRemove(),
        parse_mode="HTML",
    )


def telegram_profile_names(user) -> tuple[str, str]:
    first_name = (user.first_name or "").strip() or (user.username or "").strip() or "Telegram user"
    last_name = (user.last_name or "").strip()
    return first_name[:80], last_name[:80]


async def _register_from_profile(message: Message):
    first_name, last_name = telegram_profile_names(message.from_user)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/v1/auth/telegram/bot-register",
                json={"chat_id": str(message.chat.id), "telegram_user_id": str(message.from_user.id),
                      "first_name": first_name, "last_name": last_name},
                headers={"X-Bot-Secret": TOKEN},
            )
            response.raise_for_status()
        await redis.delete(f"telegram-registration:{message.from_user.id}",
                           f"telegram-signin-pending:{message.from_user.id}")
        await message.answer("✅ Hisobingiz Telegram profilingiz nomi bilan yaratildi!",
                             reply_markup=ReplyKeyboardRemove())
        await _send_signin_link(message)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 409:
            await message.answer("Kontakt tasdig‘i eskirgan yoki hisob allaqachon mavjud. /start bosib qayta urinib ko‘ring.")
        else:
            await message.answer("Hisob yaratib bo‘lmadi. /start bosib qayta urinib ko‘ring.")
    except httpx.HTTPError:
        await message.answer("Serverga ulanib bo‘lmadi. /start bosib kontaktingizni qayta ulashing.")


@dp.message(Command("resetaccount"))
async def reset_account(message: Message):
    if message.chat.type != "private":
        await message.answer("Bu buyruqni bot bilan shaxsiy chatda ishlating.")
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/v1/auth/telegram/bot-reset/start",
                json={"chat_id": str(message.chat.id), "telegram_user_id": str(message.from_user.id)},
                headers={"X-Bot-Secret": TOKEN},
            )
            if response.status_code == 403:
                await message.answer("Bu hisobni bot orqali o‘chirib bo‘lmaydi. Administratorga murojaat qiling.")
                return
            response.raise_for_status()
            data = response.json()
        if not data.get("registered"):
            await message.answer("Bu Telegram hisobiga ro‘yxatdan o‘tilmagan. Boshlash uchun /start bosing.")
            return
        token = data["confirmation_token"]
        await message.answer(
            "⚠️ Hisobingiz, test natijalaringiz va saqlangan javoblaringiz butunlay o‘chiriladi. "
            "Buni ortga qaytarib bo‘lmaydi. Faqat o‘zingizning hisobingiz o‘chadi.\n\n"
            "Davom etasizmi? Tasdiq 2 daqiqa amal qiladi.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Ha, hisobimni o‘chirish", callback_data=f"account_reset:yes:{token}"),
            ], [
                InlineKeyboardButton(text="Bekor qilish", callback_data=f"account_reset:no:{token}"),
            ]]),
        )
    except (httpx.HTTPError, ValueError, KeyError):
        await message.answer("Serverga ulanib bo‘lmadi. Birozdan keyin /resetaccount buyrug‘ini qayta yuboring.")


@dp.callback_query(F.data.startswith("account_reset:"))
async def confirm_account_reset(query: CallbackQuery):
    if not isinstance(query.message, Message) or query.message.chat.type != "private":
        await query.answer("Faqat shaxsiy chatda ishlating.", show_alert=True)
        return
    parts = (query.data or "").split(":", 2)
    if len(parts) != 3 or parts[1] not in {"yes", "no"}:
        await query.answer("Tasdiq noto‘g‘ri.", show_alert=True)
        return
    await query.answer()
    action, token = parts[1:]
    payload = {"chat_id": str(query.message.chat.id), "telegram_user_id": str(query.from_user.id),
               "confirmation_token": token}
    try:
        endpoint = "complete" if action == "yes" else "cancel"
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{BACKEND_URL}/api/v1/auth/telegram/bot-reset/{endpoint}",
                                         json=payload, headers={"X-Bot-Secret": TOKEN})
            if response.status_code == 409:
                await query.message.edit_text("Tasdiq eskirgan yoki avval ishlatilgan. /resetaccount buyrug‘ini qayta yuboring.")
                return
            response.raise_for_status()
        if action == "no":
            await query.message.edit_text("Bekor qilindi. Hisobingiz saqlandi.")
            return
        await query.message.edit_text("✅ Hisobingiz o‘chirildi. Endi qayta ro‘yxatdan o‘tishingiz mumkin.")
        await redis.setex(f"telegram-signin-pending:{query.from_user.id}", 600, "1")
        await query.message.answer("Qayta ro‘yxatdan o‘tish uchun o‘z kontaktingizni ulashing. Ismingiz Telegram profilingizdan olinadi.",
                                   reply_markup=_share_phone_keyboard())
    except httpx.HTTPError:
        await query.message.answer("Amalni yakunlab bo‘lmadi. /resetaccount orqali holatni qayta tekshiring.")


@dp.message(F.text)
async def text_message(message: Message):
    if message.chat.type != "private":
        return
    if (message.text or "").strip() == "/cancel":
        await redis.delete(f"telegram-registration:{message.from_user.id}",
                           f"telegram-register-contact:{message.from_user.id}",
                           f"telegram-signin-pending:{message.from_user.id}")
        await message.answer("Bekor qilindi. Qayta boshlash uchun /start bosing.")
        return
    await message.answer("Boshlash uchun /start bosing va raqamingizni kontakt tugmasi orqali ulashing.")


async def main():
    if not TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN is empty; the bot is idle.")
        while True:
            await asyncio.sleep(3600)
    bot = Bot(TOKEN)
    try:
        await redis.ping()
        webhook = await bot.get_webhook_info()
        if webhook.url:
            raise RuntimeError("This bot has an active webhook; polling was not started.")
        await bot.set_my_commands([
            BotCommand(command="start", description="Kirish yoki ro‘yxatdan o‘tish"),
            BotCommand(command="resetaccount", description="Hisobni o‘chirib qayta ro‘yxatdan o‘tish"),
            BotCommand(command="cancel", description="Joriy amalni bekor qilish"),
        ])
        identity = await bot.get_me()
        logger.info("Registon bot started as @%s", identity.username)
        await dp.start_polling(bot)
    finally:
        await redis.aclose()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
