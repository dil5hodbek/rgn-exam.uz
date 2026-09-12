import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import Role


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone_number: str
    password: str = Field(min_length=1, max_length=128)
    confirm_password: str

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class LoginRequest(BaseModel):
    phone_number: str
    password: str


class OTPRequest(BaseModel):
    phone_number: str
    purpose: Literal["login", "reset"] = "login"


class OTPVerify(BaseModel):
    phone_number: str
    code: str = Field(pattern=r"^\d{5}$")
    purpose: Literal["login", "reset"] = "login"


class BotContact(BaseModel):
    """Sent by the Telegram bot when a user shares their phone via plain /start —
    the backend matches it to an account, links it, and issues any pending code."""
    chat_id: str
    telegram_user_id: str
    phone: str


class PasswordReset(BaseModel):
    reset_token: str
    password: str = Field(min_length=1, max_length=128)
    confirm_password: str

    @model_validator(mode="after")
    def reset_passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class UserOut(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    phone_number: str
    role: Role
    theme: str
    telegram_linked: bool = False
    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    user: UserOut
    message: str = "Welcome back."


class ProfileUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    theme: str = Field(default="system", pattern=r"^(light|dark|system)$")


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1, max_length=128)
