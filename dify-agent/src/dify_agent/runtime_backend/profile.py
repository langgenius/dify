"""Deployment-selected coherent runtime backend profile construction."""

from __future__ import annotations

from typing import ClassVar, Literal, Self
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from dify_agent.runtime_backend.e2b import (
    E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    E2BHomeSnapshotBackend,
    E2BSDKControlPlane,
    E2BExecutionBindingBackend,
)
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend, EnterpriseHomeSnapshotBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend
from dify_agent.runtime_backend.protocols import RuntimeBackendProfile

DEFAULT_E2B_TEMPLATE = "difys-default-team/dify-agent-local-sandbox"


class RuntimeBackendSettings(BaseSettings):
    """Server-private credentials and endpoints for one coherent backend profile."""

    runtime_backend: Literal["local", "enterprise", "e2b"] = "local"

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

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="DIFY_AGENT_",
        env_file=(".env", "dify-agent/.env"),
        extra="ignore",
        populate_by_name=True,
    )

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
            case "e2b":
                if not self.e2b_api_key or not self.e2b_api_key.strip():
                    raise ValueError("e2b_api_key is required for the e2b runtime backend")
                if not self.e2b_template.strip():
                    raise ValueError("e2b_template must not be blank")
        return self


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
                home_snapshots=EnterpriseHomeSnapshotBackend(
                    gateway_endpoint=endpoint,
                    auth_token=token,
                    gateway_timeout=settings.enterprise_sandbox_gateway_timeout,
                ),
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
                    template=settings.e2b_template,
                    active_timeout_seconds=settings.e2b_active_timeout_seconds,
                ),
                execution_bindings=E2BExecutionBindingBackend(
                    control_plane=control_plane,
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
