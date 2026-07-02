import asyncio
import os

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove
from redis.asyncio import Redis

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
dp = Dispatcher()
redis = Redis.from_url(REDIS_URL, decode_responses=True)


@dp.message(CommandStart(deep_link=True))
async def linked_start(message: Message, command):
    payload = command.args or ""
    if not payload.startswith("link_") or not await redis.exists(f"telegram-link:{payload[5:]}"):
        await message.answer("This link has expired. Please request a new link in ExamFlow Settings.")
        return
    await redis.setex(f"telegram-pending:{message.from_user.id}", 300, payload[5:])
    keyboard = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="Share my phone number", request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )
    await message.answer("To link your account securely, share the phone number verified by Telegram.", reply_markup=keyboard)


@dp.message(CommandStart())
async def start(message: Message):
    await message.answer("Welcome to ExamFlow. Open Settings in the web app to connect your account.")


@dp.message(F.contact)
async def contact(message: Message):
    if message.contact.user_id != message.from_user.id:
        await message.answer("Please share your own Telegram contact.", reply_markup=ReplyKeyboardRemove())
        return
    token = await redis.get(f"telegram-pending:{message.from_user.id}")
    if not token:
        await message.answer("Your linking request has expired.", reply_markup=ReplyKeyboardRemove())
        return
    await redis.rpush(f"telegram-contact:{token}", f"{message.chat.id}|{message.from_user.id}|{message.contact.phone_number}")
    await redis.expire(f"telegram-contact:{token}", 300)
    await redis.delete(f"telegram-pending:{message.from_user.id}")
    await message.answer("Thanks. Return to ExamFlow to finish linking.", reply_markup=ReplyKeyboardRemove())


async def main():
    if not TOKEN:
        print("TELEGRAM_BOT_TOKEN is empty; bot is idle.")
        while True:
            await asyncio.sleep(3600)
    await dp.start_polling(Bot(TOKEN))


if __name__ == "__main__":
    asyncio.run(main())
