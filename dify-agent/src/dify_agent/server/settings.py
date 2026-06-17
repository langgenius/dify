"""Configuration for the FastAPI run server.

Outbound HTTP client settings describe the FastAPI lifespan-owned
``httpx.AsyncClient`` instances shared by local run tasks for plugin-daemon and
Dify API inner calls. Layers and Agenton providers do not own those clients, so
these settings are process resource limits rather than per-run lifecycle knobs.
Endpoint URLs and API keys stay service-specific.
"""

from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_RUN_RETENTION_SECONDS = 3 * 24 * 60 * 60


class ServerSettings(BaseSettings):
    """Environment-backed settings for Redis, scheduling, and shared HTTP clients."""

    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "dify-agent"
    shutdown_grace_seconds: float = 30
    run_retention_seconds: int = Field(default=DEFAULT_RUN_RETENTION_SECONDS, ge=1)
    plugin_daemon_url: str = "http://localhost:5002"
    plugin_daemon_api_key: str = ""
    dify_api_inner_url: str = "http://localhost:5001"
    dify_api_inner_api_key: str = ""
    outbound_http_connect_timeout: float = Field(default=10.0, ge=0)
    outbound_http_read_timeout: float = Field(default=600.0, ge=0)
    outbound_http_write_timeout: float = Field(default=30.0, ge=0)
    outbound_http_pool_timeout: float = Field(default=10.0, ge=0)
    outbound_http_max_connections: int = Field(default=100, ge=1)
    outbound_http_max_keepalive_connections: int = Field(default=20, ge=0)
    outbound_http_keepalive_expiry: float = Field(default=30.0, ge=0)

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
    )


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "ServerSettings"]
