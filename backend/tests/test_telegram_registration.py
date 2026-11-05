import uuid
from httpx import Cookies
from urllib.parse import parse_qs, urlsplit

import pytest

from app.core.config import settings
from app.core.security import create_token, decode_token
from datetime import timedelta
from app.models import User
from sqlalchemy import select


@pytest.fixture
def bot_secret(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-bot-secret")
    return {"X-Bot-Secret": "test-bot-secret"}


def identity():
    unique = str(uuid.uuid4())
    return {"chat_id": unique, "telegram_user_id": unique}


@pytest.mark.asyncio
async def test_bot_registration_requires_secret_and_verified_contact(client, bot_secret):
    payload = {**identity(), "first_name": "Test", "last_name": "Student"}
    response = await client.post("/api/v1/auth/telegram/bot-register", json=payload)
    assert response.status_code == 403
    response = await client.post("/api/v1/auth/telegram/bot-register", json=payload, headers=bot_secret)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_registration_login_and_remembered_browser(client, bot_secret):
    user = identity()
    response = await client.post("/api/v1/auth/telegram/bot-contact",
                                 json={**user, "phone": "+998901234567"}, headers=bot_secret)
    assert response.json() == {"matched": False, "reason": "no_account"}
    response = await client.post("/api/v1/auth/telegram/bot-register",
                                 json={**user, "first_name": "Telegram Name"}, headers=bot_secret)
    assert response.status_code == 201
    response = await client.post("/api/v1/auth/telegram/bot-sign-in", json=user, headers=bot_secret)
    assert response.status_code == 200
    token = parse_qs(urlsplit(response.json()["sign_in_url"]).fragment)["token"][0]
    success = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert success.status_code == 200
    first_access = decode_token(client.cookies["access_token"])
    first_refresh = decode_token(client.cookies["refresh_token"], "refresh")
    assert first_access["session_until"] == first_refresh["session_until"]
    assert 3500 <= first_access["exp"] - first_access["iat"] <= 3600
    repeated = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert repeated.status_code == 200
    assert decode_token(client.cookies["access_token"])["session_until"] == first_access["session_until"]
    refreshed = await client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    assert decode_token(client.cookies["refresh_token"], "refresh")["session_until"] == first_access["session_until"]
    saved_cookies = Cookies(client.cookies)
    client.cookies.clear()
    other_browser = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert other_browser.status_code == 401
    client.cookies = saved_cookies
    await client.post("/api/v1/auth/logout")
    logged_out = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert logged_out.status_code == 401
    assert success.json()["user"]["role"] == "STUDENT"
    assert success.json()["user"]["telegram_linked"] is True
    assert success.json()["user"]["first_name"] == "Telegram Name"
    assert success.json()["user"]["last_name"] == ""
    assert "HttpOnly" in success.headers["set-cookie"]


@pytest.mark.asyncio
async def test_contact_proof_cannot_be_used_by_another_chat(client, bot_secret):
    user = identity()
    await client.post("/api/v1/auth/telegram/bot-contact",
                      json={**user, "phone": "+998901234568"}, headers=bot_secret)
    response = await client.post("/api/v1/auth/telegram/bot-register",
                                 json={**user, "chat_id": "another-chat", "first_name": "Test", "last_name": "Student"},
                                 headers=bot_secret)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_same_browser_cannot_switch_another_account_using_the_link(client, db_session, bot_secret):
    first = identity()
    second = identity()
    for account, phone in [(first, "+998901234571"), (second, "+998901234572")]:
        await client.post("/api/v1/auth/telegram/bot-contact", json={**account, "phone": phone}, headers=bot_secret)
        response = await client.post("/api/v1/auth/telegram/bot-register",
                                     json={**account, "first_name": "Test"}, headers=bot_secret)
        assert response.status_code == 201
    link = await client.post("/api/v1/auth/telegram/bot-sign-in", json=first, headers=bot_secret)
    token = parse_qs(urlsplit(link.json()["sign_in_url"]).fragment)["token"][0]
    await client.post("/api/v1/auth/telegram/sign-in/browser")
    first_user = await db_session.scalar(select(User).where(User.phone_number == "+998901234571"))
    second_user = await db_session.scalar(select(User).where(User.phone_number == "+998901234572"))
    # Even before first use, an authenticated different account must not be switched.
    client.cookies.set("access_token", create_token(str(second_user.id), "access", timedelta(hours=1)), domain="test.local", path="/")
    response = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert response.status_code == 401
    client.cookies.delete("access_token", domain="test.local", path="/")
    response = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(first_user.id)
    client.cookies.set("access_token", create_token(str(second_user.id), "access", timedelta(hours=1)), domain="test.local", path="/")
    response = await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    assert response.status_code == 401
