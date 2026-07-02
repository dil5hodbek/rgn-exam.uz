import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Role


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone_number: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("Password must include a letter and a number.")
        return value

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


class PasswordReset(BaseModel):
    reset_token: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str

    @field_validator("password")
    @classmethod
    def strong_reset_password(cls, value: str) -> str:
        if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("Password must include a letter and a number.")
        return value

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
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def strong_new_password(cls, value: str) -> str:
        if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("Password must include a letter and a number.")
        return value
