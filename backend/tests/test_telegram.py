import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.services.telegram import TelegramDeliveryError, send_telegram_message


class TelegramDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_token_is_reported(self):
        with patch("app.services.telegram.settings.telegram_bot_token", ""):
            with self.assertRaisesRegex(TelegramDeliveryError, "not configured"):
                await send_telegram_message("123", "Hello")

    async def test_successful_message_uses_expected_payload(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"ok": True}
        client = AsyncMock()
        client.post.return_value = response
        context = AsyncMock()
        context.__aenter__.return_value = client

        with (
            patch("app.services.telegram.settings.telegram_bot_token", "test-token"),
            patch("app.services.telegram.httpx.AsyncClient", return_value=context),
        ):
            await send_telegram_message("123", "<b>Hello</b>", parse_mode="HTML")

        payload = client.post.await_args.kwargs["json"]
        self.assertEqual(payload["chat_id"], "123")
        self.assertEqual(payload["parse_mode"], "HTML")
        self.assertTrue(payload["disable_web_page_preview"])

    async def test_telegram_rejection_is_reported(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"ok": False, "description": "bot was blocked by the user"}
        client = AsyncMock()
        client.post.return_value = response
        context = AsyncMock()
        context.__aenter__.return_value = client

        with (
            patch("app.services.telegram.settings.telegram_bot_token", "test-token"),
            patch("app.services.telegram.httpx.AsyncClient", return_value=context),
        ):
            with self.assertRaisesRegex(TelegramDeliveryError, "blocked"):
                await send_telegram_message("123", "Hello")


if __name__ == "__main__":
    unittest.main()
