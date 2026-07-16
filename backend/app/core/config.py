from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ExamFlow API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://examflow:examflow@localhost:5432/examflow"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "development-only-change-this-secret"
    csrf_secret: str = "development-only-change-this-too"
    frontend_url: str = "http://localhost:3000"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    anthropic_api_key: str = ""
    docx_ai_model: str = "claude-haiku-4-5"
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-haiku-4.5"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
