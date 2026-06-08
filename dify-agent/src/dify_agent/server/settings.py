"""Configuration for the FastAPI run server.

Plugin daemon HTTP client settings describe the single FastAPI lifespan-owned
``httpx.AsyncClient`` shared by local run tasks. Layers and Agenton providers do
not own that client, so these settings are process resource limits rather than
per-run lifecycle knobs. The shell back proxy now also uses this main server
settings model directly: the public back proxy URL, server secret, and optional
Dify inner API file-request settings all live here under the longstanding
``DIFY_AGENT_...`` environment-variable namespace.
"""

from typing import ClassVar

from pydantic import AnyHttpUrl, Field, TypeAdapter, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from dify_agent.agent_stub.protocol.back_proxy import normalize_back_proxy_base_url
from dify_agent.agent_stub.server.back_proxy_files import DifyApiBackProxyFileRequestHandler
from dify_agent.agent_stub.server.tokens.back_proxy import BackProxyTokenCodec, decode_server_secret_key

DEFAULT_RUN_RETENTION_SECONDS = 3 * 24 * 60 * 60


class ServerSettings(BaseSettings):
    """Environment-backed settings for Redis, scheduling, plugin, and shell access."""

    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "dify-agent"
    shutdown_grace_seconds: float = 30
    run_retention_seconds: int = Field(default=DEFAULT_RUN_RETENTION_SECONDS, ge=1)
    plugin_daemon_url: str = "http://localhost:5002"
    plugin_daemon_api_key: str = ""
    dify_api_base_url: str | None = None
    dify_api_inner_api_key: str | None = None
    shellctl_entrypoint: str | None = None
    shellctl_auth_token: str | None = None
    shell_back_proxy_public_url: str | None = None
    server_secret_key: str | None = None
    plugin_daemon_connect_timeout: float = Field(default=10.0, ge=0)
    plugin_daemon_read_timeout: float = Field(default=600.0, ge=0)
    plugin_daemon_write_timeout: float = Field(default=30.0, ge=0)
    plugin_daemon_pool_timeout: float = Field(default=10.0, ge=0)
    plugin_daemon_max_connections: int = Field(default=100, ge=1)
    plugin_daemon_max_keepalive_connections: int = Field(default=20, ge=0)
    plugin_daemon_keepalive_expiry: float = Field(default=30.0, ge=0)

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
    )

    @field_validator("shell_back_proxy_public_url")
    @classmethod
    def normalize_shell_back_proxy_public_url(cls, value: str | None) -> str | None:
        """Normalize the public shell back proxy URL while still validating HTTP(S)."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        validated = str(TypeAdapter(AnyHttpUrl).validate_python(stripped))
        return normalize_back_proxy_base_url(validated)

    @field_validator("server_secret_key")
    @classmethod
    def validate_server_secret_key(cls, value: str | None) -> str | None:
        """Validate the configured base64url-encoded server root secret."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        _ = decode_server_secret_key(stripped)
        return stripped

    @field_validator("dify_api_base_url")
    @classmethod
    def normalize_dify_api_base_url(cls, value: str | None) -> str | None:
        """Normalize the trusted Dify API base URL used for file request calls."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        validated = str(TypeAdapter(AnyHttpUrl).validate_python(stripped))
        parsed = validated.rstrip("/")
        if "?" in parsed or "#" in parsed:
            raise ValueError("DIFY_AGENT_DIFY_API_BASE_URL must not include a query string or fragment")
        return parsed

    @field_validator("dify_api_inner_api_key")
    @classmethod
    def normalize_dify_api_inner_api_key(cls, value: str | None) -> str | None:
        """Normalize the optional trusted Dify inner API key."""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_shell_back_proxy_requirements(self) -> "ServerSettings":
        """Require the server secret and Dify API file settings in valid pairs."""
        if self.shell_back_proxy_public_url is not None and self.server_secret_key is None:
            raise ValueError(
                "DIFY_AGENT_SERVER_SECRET_KEY is required when DIFY_AGENT_SHELL_BACK_PROXY_PUBLIC_URL is set."
            )
        if (self.dify_api_base_url is None) != (self.dify_api_inner_api_key is None):
            raise ValueError(
                "DIFY_AGENT_DIFY_API_BASE_URL and DIFY_AGENT_DIFY_API_INNER_API_KEY must be set together."
            )
        return self

    def create_back_proxy_token_codec(self) -> BackProxyTokenCodec | None:
        """Return the shell back proxy token codec when the server secret is configured."""
        if self.server_secret_key is None:
            return None
        return BackProxyTokenCodec.from_server_secret(self.server_secret_key)

    def create_back_proxy_file_request_handler(self) -> DifyApiBackProxyFileRequestHandler | None:
        """Return the Dify API file bridge when both Dify API settings are configured."""
        if self.dify_api_base_url is None or self.dify_api_inner_api_key is None:
            return None
        return DifyApiBackProxyFileRequestHandler(
            dify_api_base_url=self.dify_api_base_url,
            dify_api_inner_api_key=self.dify_api_inner_api_key,
        )


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "ServerSettings"]
