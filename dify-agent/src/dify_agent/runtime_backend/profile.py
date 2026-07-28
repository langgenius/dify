"""Deployment-selected coherent runtime backend profile construction."""

from __future__ import annotations

from typing import ClassVar, Literal, Self
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from dify_agent.runtime_backend.e2b import (
    E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    E2BHomeSnapshotBackend,
    E2BSDKControlPlane,
    E2BExecutionBindingBackend,
)
from dify_agent.runtime_backend.e2b_s3 import (
    E2BHomeSnapshotCLI,
    E2BS3ExecutionBindingBackend,
    E2BS3HomeSnapshotBackend,
    OpenDALHomeArchiveStore,
)
from dify_agent.agent_stub.server.tokens.home_snapshot import HomeSnapshotTransferTokenCodec
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend, EnterpriseHomeSnapshotBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend
from dify_agent.runtime_backend.protocols import RuntimeBackendProfile

DEFAULT_E2B_TEMPLATE = "difys-default-team/dify-agent-local-sandbox"


class RuntimeBackendSettings(BaseSettings):
    """Server-private credentials and endpoints for one coherent backend profile."""

    runtime_backend: Literal["local", "enterprise", "e2b", "e2b_s3"] = "local"

    local_sandbox_endpoint: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT",
            "DIFY_AGENT_SHELLCTL_ENTRYPOINT",
        ),
    )
    local_sandbox_auth_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN",
            "DIFY_AGENT_SHELLCTL_AUTH_TOKEN",
        ),
    )

    enterprise_sandbox_gateway_endpoint: str | None = None
    enterprise_sandbox_gateway_auth_token: str | None = None
    enterprise_sandbox_gateway_timeout: float = Field(default=30.0, gt=0)
    enterprise_sandbox_proxy_timeout: float = Field(default=60.0, gt=0)

    e2b_api_key: str | None = None
    e2b_template: str = DEFAULT_E2B_TEMPLATE
    e2b_active_timeout_seconds: int = Field(
        default=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
        ge=1,
        le=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    e2b_shellctl_auth_token: str = ""
    e2b_shellctl_port: int = Field(default=5004, ge=1, le=65535)
    e2b_s3_bucket: str | None = None
    e2b_s3_root: str = "dify-agent"
    e2b_s3_region: str | None = None
    e2b_s3_endpoint: str | None = None
    e2b_s3_access_key_id: str | None = None
    e2b_s3_secret_access_key: str | None = None
    e2b_s3_session_token: str | None = None
    agent_stub_api_base_url: str | None = None
    server_secret_key: str | None = None

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
        populate_by_name=True,
    )

    @field_validator(
        "e2b_api_key",
        "e2b_s3_bucket",
        "e2b_s3_region",
        "e2b_s3_endpoint",
        "e2b_s3_access_key_id",
        "e2b_s3_secret_access_key",
        "e2b_s3_session_token",
        "agent_stub_api_base_url",
        "server_secret_key",
        mode="before",
    )
    @classmethod
    def normalize_optional_e2b_s3_value(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def validate_selected_backend(self) -> Self:
        match self.runtime_backend:
            case "local":
                if not self.local_sandbox_endpoint or not self.local_sandbox_endpoint.strip():
                    raise ValueError("local_sandbox_endpoint is required for the local runtime backend")
                _validate_http_url(self.local_sandbox_endpoint, field_name="local_sandbox_endpoint")
            case "enterprise":
                endpoint = self.enterprise_sandbox_gateway_endpoint
                if not endpoint or not endpoint.strip():
                    raise ValueError(
                        "enterprise_sandbox_gateway_endpoint is required for the enterprise runtime backend"
                    )
                _validate_http_url(endpoint, field_name="enterprise_sandbox_gateway_endpoint")
            case "e2b" | "e2b_s3":
                if not self.e2b_api_key or not self.e2b_api_key.strip():
                    raise ValueError(f"e2b_api_key is required for the {self.runtime_backend} runtime backend")
                if not self.e2b_template.strip():
                    raise ValueError("e2b_template must not be blank")
                if self.runtime_backend == "e2b_s3":
                    self._validate_e2b_s3()
        return self

    def _validate_e2b_s3(self) -> None:
        if not self.e2b_s3_bucket or not self.e2b_s3_bucket.strip():
            raise ValueError("e2b_s3_bucket is required for the e2b_s3 runtime backend")
        if not self.e2b_s3_root.strip():
            raise ValueError("e2b_s3_root must not be blank")
        if self.e2b_s3_endpoint is not None:
            _validate_http_url(self.e2b_s3_endpoint, field_name="e2b_s3_endpoint")
        has_access_key = bool(self.e2b_s3_access_key_id and self.e2b_s3_access_key_id.strip())
        has_secret_key = bool(self.e2b_s3_secret_access_key and self.e2b_s3_secret_access_key.strip())
        if has_access_key != has_secret_key:
            raise ValueError("e2b_s3_access_key_id and e2b_s3_secret_access_key must be configured together")
        if self.e2b_s3_session_token and self.e2b_s3_session_token.strip() and not has_access_key:
            raise ValueError("e2b_s3_session_token requires explicit S3 credentials")
        if not self.agent_stub_api_base_url:
            raise ValueError("agent_stub_api_base_url is required for the e2b_s3 runtime backend")
        _validate_http_url(self.agent_stub_api_base_url, field_name="agent_stub_api_base_url")
        if not self.server_secret_key:
            raise ValueError("server_secret_key is required for the e2b_s3 runtime backend")
        _ = HomeSnapshotTransferTokenCodec.from_server_secret(self.server_secret_key)


def create_runtime_backend_profile(settings: RuntimeBackendSettings) -> RuntimeBackendProfile:
    """Construct one driver pair selected exclusively by server deployment settings."""
    match settings.runtime_backend:
        case "local":
            endpoint = settings.local_sandbox_endpoint or ""
            token = settings.local_sandbox_auth_token or ""
            return RuntimeBackendProfile(
                home_snapshots=LocalHomeSnapshotBackend(endpoint=endpoint, auth_token=token),
                execution_bindings=LocalExecutionBindingBackend(endpoint=endpoint, auth_token=token),
            )
        case "enterprise":
            endpoint = settings.enterprise_sandbox_gateway_endpoint or ""
            token = settings.enterprise_sandbox_gateway_auth_token or ""
            return RuntimeBackendProfile(
                home_snapshots=EnterpriseHomeSnapshotBackend(),
                execution_bindings=EnterpriseExecutionBindingBackend(
                    gateway_endpoint=endpoint,
                    auth_token=token,
                    gateway_timeout=settings.enterprise_sandbox_gateway_timeout,
                    proxy_timeout=settings.enterprise_sandbox_proxy_timeout,
                ),
            )
        case "e2b":
            control_plane = E2BSDKControlPlane(api_key=settings.e2b_api_key or "")
            return RuntimeBackendProfile(
                home_snapshots=E2BHomeSnapshotBackend(
                    control_plane=control_plane,
                ),
                execution_bindings=E2BExecutionBindingBackend(
                    control_plane=control_plane,
                    template=settings.e2b_template,
                    active_timeout_seconds=settings.e2b_active_timeout_seconds,
                    shellctl_auth_token=settings.e2b_shellctl_auth_token,
                    shellctl_port=settings.e2b_shellctl_port,
                ),
            )
        case "e2b_s3":
            control_plane = E2BSDKControlPlane(api_key=settings.e2b_api_key or "")
            archive_store = OpenDALHomeArchiveStore.create_s3(
                bucket=settings.e2b_s3_bucket or "",
                root=settings.e2b_s3_root,
                region=settings.e2b_s3_region,
                endpoint=settings.e2b_s3_endpoint,
                access_key_id=settings.e2b_s3_access_key_id,
                secret_access_key=settings.e2b_s3_secret_access_key,
                session_token=settings.e2b_s3_session_token,
            )
            token_codec = HomeSnapshotTransferTokenCodec.from_server_secret(settings.server_secret_key or "")
            lifecycle_cli = E2BHomeSnapshotCLI(
                token_codec=token_codec,
                agent_stub_api_base_url=settings.agent_stub_api_base_url or "",
                shellctl_auth_token=settings.e2b_shellctl_auth_token,
                shellctl_port=settings.e2b_shellctl_port,
            )
            return RuntimeBackendProfile(
                home_snapshots=E2BS3HomeSnapshotBackend(
                    control_plane=control_plane,
                    archive_store=archive_store,
                    lifecycle_cli=lifecycle_cli,
                    template=settings.e2b_template,
                    active_timeout_seconds=settings.e2b_active_timeout_seconds,
                ),
                execution_bindings=E2BS3ExecutionBindingBackend(
                    control_plane=control_plane,
                    lifecycle_cli=lifecycle_cli,
                    template=settings.e2b_template,
                    active_timeout_seconds=settings.e2b_active_timeout_seconds,
                    shellctl_auth_token=settings.e2b_shellctl_auth_token,
                    shellctl_port=settings.e2b_shellctl_port,
                ),
            )


def _validate_http_url(value: str, *, field_name: str) -> None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http(s) URL")


__all__ = ["DEFAULT_E2B_TEMPLATE", "RuntimeBackendSettings", "create_runtime_backend_profile"]
