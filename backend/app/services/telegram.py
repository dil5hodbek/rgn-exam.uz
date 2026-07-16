import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class TelegramDeliveryError(RuntimeError):
    pass


async def send_telegram_message(chat_id: str, text: str, *, parse_mode: str | None = None) -> None:
    if not settings.telegram_bot_token:
        raise TelegramDeliveryError("Telegram bot is not configured.")

    payload: dict[str, str | bool] = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise TelegramDeliveryError("Could not reach Telegram.") from exc

    if not data.get("ok"):
        description = data.get("description", "Telegram rejected the message.")
        logger.warning("Telegram rejected a message: %s", description)
        raise TelegramDeliveryError(description)
