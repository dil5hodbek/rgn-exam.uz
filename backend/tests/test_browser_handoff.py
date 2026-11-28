"""'Open in Chrome': a signed-in browser mints a single-use code that another
browser trades for the same session — never a longer one."""
from urllib.parse import parse_qs, urlsplit

from app.core.config import settings
from app.core.security import decode_token
from test_telegram_registration import identity


async def test_handoff_moves_the_session_once(client, db_session):
    from test_attempts_flow import _register_and_login
    await _register_and_login(client, db=db_session)
    me = (await client.get("/api/v1/auth/me")).json()

    code = (await client.post("/api/v1/auth/handoff")).json()["code"]
    client.cookies.clear()  # the other browser has no cookies
    assert (await client.get("/api/v1/auth/me")).status_code == 401

    done = await client.post("/api/v1/auth/handoff/complete", json={"token": code})
    assert done.status_code == 200 and done.json()["user"]["id"] == me["id"]
    assert (await client.get("/api/v1/auth/me")).json()["id"] == me["id"]

    client.cookies.clear()
    again = await client.post("/api/v1/auth/handoff/complete", json={"token": code})
    assert again.status_code == 401  # single use
    bogus = await client.post("/api/v1/auth/handoff/complete", json={"token": "x" * 43})
    assert bogus.status_code == 401


async def test_handoff_needs_a_session(client):
    assert (await client.post("/api/v1/auth/handoff")).status_code == 401


async def test_handoff_keeps_a_telegram_session_cap(client, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-bot-secret")
    secret = {"X-Bot-Secret": "test-bot-secret"}
    user = identity()
    await client.post("/api/v1/auth/telegram/bot-contact", json={**user, "phone": "+998901234588"}, headers=secret)
    await client.post("/api/v1/auth/telegram/bot-register", json={**user, "first_name": "Tg"}, headers=secret)
    link = (await client.post("/api/v1/auth/telegram/bot-sign-in", json=user, headers=secret)).json()["sign_in_url"]
    token = parse_qs(urlsplit(link).fragment)["token"][0]
    await client.post("/api/v1/auth/telegram/sign-in/complete", json={"token": token})
    cap = decode_token(client.cookies["access_token"])["session_until"]

    code = (await client.post("/api/v1/auth/handoff")).json()["code"]
    client.cookies.clear()
    assert (await client.post("/api/v1/auth/handoff/complete", json={"token": code})).status_code == 200
    assert decode_token(client.cookies["access_token"])["session_until"] == cap
    assert decode_token(client.cookies["refresh_token"], "refresh")["session_until"] == cap
