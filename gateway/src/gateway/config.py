"""Gateway configuration loaded from environment variables.

All settings live under the ``GATEWAY_`` prefix. ``Settings`` is constructed
once at startup (see ``main.py``) and injected into the FastAPI app state.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-level configuration.

    Read from environment variables with ``GATEWAY_`` prefix; ``.env`` files
    are loaded automatically when present.
    """

    model_config = SettingsConfigDict(
        env_prefix="GATEWAY_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    host: str = Field(default="0.0.0.0", description="Bind address")
    port: int = Field(default=8080, ge=1, le=65535, description="Bind port")
    log_level: str = Field(default="INFO", description="Log level (DEBUG/INFO/WARNING/ERROR)")
    log_json: bool = Field(default=True, description="Emit logs as JSON via structlog")

    registry_path: str = Field(
        default="./registry.yaml",
        description="Path to the customer registry YAML file",
    )

    dify_timeout_s: float = Field(
        default=60.0,
        gt=0,
        description="HTTP timeout for Dify Service/Console API calls",
    )
    dify_stream_timeout_s: float = Field(
        default=300.0,
        gt=0,
        description="HTTP timeout for streaming chat-messages (longer than blocking)",
    )

    app_cache_ttl_s: int = Field(
        default=7 * 24 * 3600,
        gt=0,
        description="Idle TTL for cached (customer, model) -> Dify App entries",
    )
    app_cache_gc_interval_s: int = Field(
        default=3600,
        gt=0,
        description="Interval between GC sweeps over the App cache",
    )

    request_id_header: str = Field(
        default="x-request-id",
        description="Header name to read/echo for distributed tracing",
    )
