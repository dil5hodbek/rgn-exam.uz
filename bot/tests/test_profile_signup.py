import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as bot


class ProfileSignupTests(unittest.IsolatedAsyncioTestCase):
    def test_profile_without_surname_is_supported(self):
        user = SimpleNamespace(first_name=" Dilshodbek ", last_name=None, username="dilshodbek")
        self.assertEqual(bot.telegram_profile_names(user), ("Dilshodbek", ""))

    async def test_contact_creates_account_from_telegram_profile_without_name_prompts(self):
        message = SimpleNamespace(
            chat=SimpleNamespace(id=123, type="private"),
            from_user=SimpleNamespace(id=123, first_name="Telegram Name", last_name=None, username="username"),
            contact=SimpleNamespace(user_id=123, phone_number="998901234567"),
            answer=AsyncMock(),
        )
        contact_response = Mock()
        contact_response.json.return_value = {"matched": False, "reason": "no_account"}
        registration_response = Mock()
        client = AsyncMock()
        client.post.side_effect = [contact_response, registration_response]
        context = AsyncMock()
        context.__aenter__.return_value = client
        with patch.object(bot.httpx, "AsyncClient", return_value=context), \
             patch.object(bot, "redis", AsyncMock()), \
             patch.object(bot, "_send_signin_link", AsyncMock()) as send_link:
            await bot._handle_shared_contact(message)
        payload = client.post.await_args_list[1].kwargs["json"]
        self.assertEqual(payload["first_name"], "Telegram Name")
        self.assertEqual(payload["last_name"], "")
        send_link.assert_awaited_once_with(message)
        prompts = [call.args[0] for call in message.answer.await_args_list]
        self.assertFalse(any("Ismingizni" in text or "familiyangizni" in text for text in prompts))

    async def test_other_persons_contact_is_rejected(self):
        message = SimpleNamespace(chat=SimpleNamespace(type="private"),
                                  from_user=SimpleNamespace(id=123),
                                  contact=SimpleNamespace(user_id=456), answer=AsyncMock())
        with patch.object(bot, "_handle_shared_contact", AsyncMock()) as shared:
            await bot.contact(message)
        shared.assert_not_awaited()
        message.answer.assert_awaited_once()
