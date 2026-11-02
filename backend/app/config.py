"""Application settings, loaded from environment variables and the repo-root `.env` file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

MIN_PRODUCTION_SECRET_LENGTH = 32

AppEnv = Literal["development", "test", "production"]
AuthMode = Literal["dev", "sso"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden by an environment variable."""

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Pulse API"
    app_env: AppEnv = "development"
    auth_mode: AuthMode = "dev"
    log_level: LogLevel = "INFO"

    jwt_secret: SecretStr
    jwt_expires_minutes: int = Field(default=480, ge=5, le=60 * 24)

    database_url: str
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_echo: bool = False
    health_db_timeout_seconds: float = Field(default=2.0, gt=0, le=30)

    file_storage_path: Path = REPO_ROOT / "data" / "files"
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string (the form used in `.env`) as well as a list."""
        if isinstance(value, str):
            return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            msg = "DATABASE_URL must use the async driver: postgresql+asyncpg://..."
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _check_production_safety(self) -> Settings:
        if not self.file_storage_path.is_absolute():
            if self.app_env == "production":
                msg = "FILE_STORAGE_PATH must be an absolute path in production"
                raise ValueError(msg)
            # In development, relative paths are relative to the repo root, not the cwd.
            self.file_storage_path = (REPO_ROOT / self.file_storage_path).resolve()
        if self.app_env == "production":
            if len(self.jwt_secret.get_secret_value()) < MIN_PRODUCTION_SECRET_LENGTH:
                msg = (
                    f"JWT_SECRET must be at least {MIN_PRODUCTION_SECRET_LENGTH} characters "
                    "in production"
                )
                raise ValueError(msg)
            if "*" in self.cors_origins:
                msg = "CORS_ORIGINS cannot contain '*' in production"
                raise ValueError(msg)
            if self.db_echo:
                msg = "DB_ECHO must be off in production (it logs query parameters)"
                raise ValueError(msg)
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings. Cached so the environment is read once."""
    return Settings()
