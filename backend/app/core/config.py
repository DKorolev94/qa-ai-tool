from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    LLM_BASE_URL: str = "http://localhost:11434/v1"
    LLM_MODEL: str = "gemma3:4b"
    LLM_API_KEY: str = "ollama"
    LLM_TEMPERATURE: float = 0.2
    LLM_TEMPERATURE_REVIEW: float | None = None
    LLM_TEMPERATURE_IMPROVE: float | None = None
    LLM_TIMEOUT_SECONDS: int = 120
    LLM_NUM_CTX: int | None = None

    TESTIT_BASE_URL: str = ""
    TESTIT_PRIVATE_TOKEN: str = ""
    TESTIT_AUTH_SCHEME: str = "PrivateToken"
    TESTIT_TIMEOUT_SECONDS: int = 30
    TESTIT_VERIFY_SSL: bool = True

    RUNNER_URL: str = "http://localhost:8008"
    RUNNER_TIMEOUT_SEC: int = 180
    RUNNER_RUNS_DIR: str = ""

    # Comma-separated allowed origins for the frontend, or "*" for any (dev default).
    # Lock this down to the real frontend origin(s) before a production deployment.
    CORS_ORIGINS: str = "*"

    @field_validator("TESTIT_BASE_URL", mode="after")
    @classmethod
    def strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    model_config = SettingsConfigDict(
        env_file=["../.env", ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
