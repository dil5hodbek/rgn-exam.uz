import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if digits.startswith("998") and len(digits) == 12:
        return f"+{digits}"
    if len(digits) == 9:
        return f"+998{digits}"
    raise ValueError("Enter a valid Uzbekistan phone number.")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(subject: str, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired session.") from exc
    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type.")
    return payload


def hash_otp(code: str) -> str:
    return hashlib.sha256(f"{code}:{settings.csrf_secret}".encode()).hexdigest()


def new_otp() -> str:
    return f"{secrets.randbelow(100000):05d}"
