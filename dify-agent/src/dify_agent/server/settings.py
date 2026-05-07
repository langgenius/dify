"""Configuration for the FastAPI run server and embedded worker."""

from typing import ClassVar

from pydantic_settings import BaseSettings, SettingsConfigDict


class ServerSettings(BaseSettings):
    """Environment-backed settings shared by HTTP routes and the run worker.

    The default deployment mode runs the Redis Streams worker inside the FastAPI
    process so a single ``uvicorn`` command is enough for local development and
    small deployments. Set ``DIFY_AGENT_WORKER_ENABLED=false`` when running a
    separate worker process or when only the HTTP API should be started.
    """

    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "dify-agent"
    worker_enabled: bool = True
    worker_group_name: str = "run-workers"
    worker_consumer_name: str | None = None
    worker_pending_idle_ms: int = 600_000

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
    )


__all__ = ["ServerSettings"]
