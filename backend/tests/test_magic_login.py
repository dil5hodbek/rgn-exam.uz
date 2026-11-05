import asyncio
import secrets

import pytest
import pytest_asyncio
from redis.asyncio import Redis

from app.core.config import settings
from app.services.magic_login import MAGIC_LINK_TTL, issue_magic_token, redeem_magic_token, token_key, used_token_key


@pytest_asyncio.fixture
async def store(require_redis):
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    yield redis
    await redis.aclose()


@pytest.mark.asyncio
async def test_unique_links_are_hashed_and_last_one_hour(store):
    first = await issue_magic_token(store, "test-user")
    second = await issue_magic_token(store, "test-user")
    try:
        assert first != second
        assert first not in token_key(first)
        assert MAGIC_LINK_TTL == 3600
        assert 3590 <= await store.ttl(token_key(first)) <= 3600
    finally:
        await store.delete(token_key(first), token_key(second))


@pytest.mark.asyncio
async def test_same_browser_reopens_but_other_browser_or_account_cannot(store):
    token = await issue_magic_token(store, "test-user")
    try:
        first = await redeem_magic_token(store, token, "browser-one")
        again = await redeem_magic_token(store, token, "browser-one", "test-user")
        assert first["user_id"] == again["user_id"] == "test-user"
        assert first["session_until"] == again["session_until"]
        assert again["seconds_remaining"] <= first["seconds_remaining"]
        assert await redeem_magic_token(store, token, "browser-two") is None
        assert await redeem_magic_token(store, token, "browser-one", "another-user") is None
    finally:
        await store.delete(token_key(token), used_token_key(token))


@pytest.mark.asyncio
async def test_concurrent_browsers_cannot_share_a_link(store):
    token = await issue_magic_token(store, "test-user")
    try:
        results = await asyncio.gather(*(redeem_magic_token(store, token, secrets.token_urlsafe(16)) for _ in range(10)))
        assert sum(result is not None for result in results) == 1
    finally:
        await store.delete(token_key(token), used_token_key(token))


@pytest.mark.asyncio
async def test_expired_unused_and_remembered_links_are_rejected(store):
    token = await issue_magic_token(store, "test-user")
    await store.delete(token_key(token))
    assert await redeem_magic_token(store, token, "browser-one") is None
    token = await issue_magic_token(store, "test-user")
    await redeem_magic_token(store, token, "browser-one")
    await store.delete(used_token_key(token))
    assert await redeem_magic_token(store, token, "browser-one") is None
