from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULTS = {
    "jwt_secret": "development-only-change-this-secret",
    "csrf_secret": "development-only-change-this-too",
    "admin_password": "ChangeMe123!",
}


class Settings(BaseSettings):
    app_name: str = "Registon API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://examflow:examflow@localhost:5432/examflow"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "development-only-change-this-secret"
    csrf_secret: str = "development-only-change-this-too"
    frontend_url: str = "http://localhost:3000"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    anthropic_api_key: str = ""
    docx_ai_model: str = "claude-sonnet-4-5"
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4.5"
    # OpenRouter pre-reserves credits for max_tokens; keep this within your
    # account balance. 4096 is plenty for question-text JSON.
    openrouter_max_tokens: int = 4096
    access_token_minutes: int = 20
    refresh_token_days: int = 14
    cookie_secure: bool = False
    storage_path: Path = Path("./uploads")
    max_upload_mb: int = 250
    admin_phone: str = "+998900000001"
    admin_password: str = "ChangeMe123!"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _forbid_insecure_defaults_in_production(self) -> "Settings":
        if self.environment != "production":
            return self
        leaked = [
            field for field, default in _INSECURE_DEFAULTS.items()
            if getattr(self, field) == default
        ]
        if leaked:
            raise ValueError(
                "Refusing to start with insecure default values in production for: "
                f"{', '.join(leaked)}. Set them via environment variables or .env."
            )
        if not self.cookie_secure:
            raise ValueError(
                "COOKIE_SECURE must be true in production (HTTPS is required)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
