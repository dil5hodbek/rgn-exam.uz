"""One-hour Telegram links, bound to the first browser that redeems them."""
import hashlib
import secrets

MAGIC_LINK_TTL = 3600


def token_key(token: str) -> str:
    return "telegram-signin:" + hashlib.sha256(token.encode()).hexdigest()


def used_token_key(token: str) -> str:
    return token_key(token) + ":browser"


async def issue_magic_token(redis, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await redis.set(token_key(token), user_id, ex=MAGIC_LINK_TTL)
    return token


_REDEEM = """
local user = redis.call('GET', KEYS[1])
local account = ARGV[2]
if user then
    if account ~= '' and account ~= user then return nil end
    local now = tonumber(redis.call('TIME')[1])
    local deadline = now + tonumber(ARGV[3])
    redis.call('SET', KEYS[2], cjson.encode({user_id=user, browser=ARGV[1], deadline=deadline}), 'EX', ARGV[3])
    redis.call('DEL', KEYS[1])
    return {user, tonumber(ARGV[3]), deadline}
end
local raw = redis.call('GET', KEYS[2])
if not raw then return nil end
local used = cjson.decode(raw)
if used.browser ~= ARGV[1] or (account ~= '' and account ~= used.user_id) then return nil end
local remaining = redis.call('TTL', KEYS[2])
if remaining <= 0 then return nil end
return {used.user_id, remaining, used.deadline}
"""


async def redeem_magic_token(redis, token: str, browser_secret: str, current_user_id: str = "") -> dict | None:
    browser_hash = hashlib.sha256(browser_secret.encode()).hexdigest()
    result = await redis.eval(_REDEEM, 2, token_key(token), used_token_key(token),
                              browser_hash, current_user_id, MAGIC_LINK_TTL)
    if not result:
        return None
    return {"user_id": result[0], "seconds_remaining": int(result[1]), "session_until": int(result[2])}
