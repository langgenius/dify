"""Configuration for the FastAPI run server."""

from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_RUN_RETENTION_SECONDS = 3 * 24 * 60 * 60


class ServerSettings(BaseSettings):
    """Environment-backed settings for Redis persistence, retention, and local scheduling."""

    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "dify-agent"
    shutdown_grace_seconds: float = 30
    run_retention_seconds: int = Field(default=DEFAULT_RUN_RETENTION_SECONDS, ge=1)

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
    )


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "ServerSettings"]
