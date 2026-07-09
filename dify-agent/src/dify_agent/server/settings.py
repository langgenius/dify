"""Configuration for the FastAPI run server.

Outbound HTTP client settings describe the FastAPI lifespan-owned
``httpx.AsyncClient`` instances shared by local run tasks for plugin-daemon and
Dify API inner calls. Layers and Agenton providers do not own those clients, so
these settings are process resource limits rather than per-run lifecycle knobs.
Endpoint URLs and API keys stay service-specific. The Agent Stub also uses this
settings model directly: the public Agent Stub API base URL, server secret,
optional gRPC bind override, and optional Dify inner API bridge settings all
live here under the ``DIFY_AGENT_...`` environment-variable namespace.
"""

import httpx

from typing import ClassVar

from pydantic import AnyHttpUrl, Field, TypeAdapter, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from dify_agent.agent_stub.protocol.agent_stub import normalize_agent_stub_api_base_url, parse_agent_stub_endpoint
from dify_agent.agent_stub.server.agent_stub_config import DifyApiAgentStubConfigRequestHandler
from dify_agent.agent_stub.server.agent_stub_drive import DifyApiAgentStubDriveRequestHandler
from dify_agent.agent_stub.server.agent_stub_files import DifyApiAgentStubFileRequestHandler
from dify_agent.agent_stub.server.grpc_bind import normalize_agent_stub_grpc_bind_address
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec, decode_server_secret_key

DEFAULT_RUN_RETENTION_SECONDS = 3 * 24 * 60 * 60


class ServerSettings(BaseSettings):
    """Environment-backed settings for Redis, scheduling, outbound HTTP, shell access, and Agent Stub."""

    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "dify-agent"
    shutdown_grace_seconds: float = 30
    run_retention_seconds: int = Field(default=DEFAULT_RUN_RETENTION_SECONDS, ge=1)
    plugin_daemon_url: str = "http://localhost:5002"
    plugin_daemon_api_key: str = ""
    inner_api_url: str = "http://localhost:5001"
    inner_api_key: str | None = None
    shellctl_entrypoint: str | None = None
    shellctl_auth_token: str | None = None
    agent_stub_api_base_url: str | None = Field(default=None, validation_alias="DIFY_AGENT_STUB_API_BASE_URL")
    agent_stub_grpc_bind_address: str | None = Field(default=None, validation_alias="DIFY_AGENT_STUB_GRPC_BIND_ADDRESS")
    server_secret_key: str | None = None
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
        populate_by_name=True,
    )

    @field_validator("agent_stub_api_base_url")
    @classmethod
    def normalize_agent_stub_api_base_url_value(cls, value: str | None) -> str | None:
        """Normalize the public Agent Stub URL while still validating its scheme."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.startswith(("http://", "https://")):
            validated = str(TypeAdapter(AnyHttpUrl).validate_python(stripped))
            return normalize_agent_stub_api_base_url(validated)
        return normalize_agent_stub_api_base_url(stripped)

    @field_validator("agent_stub_grpc_bind_address")
    @classmethod
    def normalize_agent_stub_grpc_bind_address_value(cls, value: str | None) -> str | None:
        """Normalize the optional explicit Agent Stub gRPC bind override."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        return normalize_agent_stub_grpc_bind_address(stripped)

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

    @field_validator("inner_api_url")
    @classmethod
    def normalize_inner_api_url(cls, value: str) -> str:
        """Normalize the trusted Dify API base URL used for inner API calls."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("DIFY_AGENT_INNER_API_URL must not be empty")
        validated = str(TypeAdapter(AnyHttpUrl).validate_python(stripped))
        parsed = validated.rstrip("/")
        if "?" in parsed or "#" in parsed:
            raise ValueError("DIFY_AGENT_INNER_API_URL must not include a query string or fragment")
        return parsed

    @field_validator("inner_api_key")
    @classmethod
    def normalize_inner_api_key(cls, value: str | None) -> str | None:
        """Normalize the optional trusted Dify inner API key."""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_agent_stub_requirements(self) -> "ServerSettings":
        """Require Agent Stub settings while allowing deployments without inner API calls."""
        if self.agent_stub_api_base_url is not None and self.server_secret_key is None:
            raise ValueError("DIFY_AGENT_SERVER_SECRET_KEY is required when DIFY_AGENT_STUB_API_BASE_URL is set.")
        if self.agent_stub_grpc_bind_address is not None:
            if self.agent_stub_api_base_url is None:
                raise ValueError(
                    "DIFY_AGENT_STUB_API_BASE_URL is required when DIFY_AGENT_STUB_GRPC_BIND_ADDRESS is set."
                )
            if not parse_agent_stub_endpoint(self.agent_stub_api_base_url).is_grpc:
                raise ValueError("DIFY_AGENT_STUB_GRPC_BIND_ADDRESS requires a grpc:// DIFY_AGENT_STUB_API_BASE_URL.")
        return self

    def create_agent_stub_token_codec(self) -> AgentStubTokenCodec | None:
        """Return the Agent Stub token codec when the server secret is configured."""
        if self.server_secret_key is None:
            return None
        return AgentStubTokenCodec.from_server_secret(self.server_secret_key)

    def create_agent_stub_file_request_handler(self) -> DifyApiAgentStubFileRequestHandler | None:
        """Return the Dify API file bridge when both Dify API settings are configured."""
        if self.inner_api_key is None:
            return None
        return DifyApiAgentStubFileRequestHandler(
            inner_api_url=self.inner_api_url,
            inner_api_key=self.inner_api_key,
        )

    def create_agent_stub_config_request_handler(self) -> DifyApiAgentStubConfigRequestHandler | None:
        """Return the Dify API config bridge when both Dify API settings are configured."""
        if self.inner_api_key is None:
            return None
        return DifyApiAgentStubConfigRequestHandler(
            inner_api_url=self.inner_api_url,
            inner_api_key=self.inner_api_key,
            timeout=self.create_outbound_http_timeout(),
        )

    def create_agent_stub_drive_request_handler(self) -> DifyApiAgentStubDriveRequestHandler | None:
        """Return the Dify API drive bridge when both Dify API settings are configured.

        Drive manifest and commit requests should honor the same outbound timeout
        settings as the server's other trusted Dify API HTTP calls.
        """
        if self.inner_api_key is None:
            return None
        return DifyApiAgentStubDriveRequestHandler(
            inner_api_url=self.inner_api_url,
            inner_api_key=self.inner_api_key,
            timeout=self.create_outbound_http_timeout(),
        )

    def create_outbound_http_timeout(self) -> httpx.Timeout:
        """Build one shared outbound HTTP timeout object from server settings."""
        return httpx.Timeout(
            connect=self.outbound_http_connect_timeout,
            read=self.outbound_http_read_timeout,
            write=self.outbound_http_write_timeout,
            pool=self.outbound_http_pool_timeout,
        )


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "ServerSettings"]
