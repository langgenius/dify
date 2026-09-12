"""Deployment-selected coherent runtime backend profile construction."""

from __future__ import annotations

import posixpath
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
from dify_agent.runtime_backend.local_rollout import (
    LocalRuntimeRouter,
    LocalRuntimeTarget,
    RoutedLocalExecutionBindingBackend,
    RoutedLocalHomeSnapshotBackend,
    ShellctlHealthProbe,
)
from dify_agent.runtime_backend.protocols import RuntimeBackendProfile
from dify_agent.adapters.shell.shellctl import create_default_shellctl_client_factory

DEFAULT_E2B_TEMPLATE = "difys-default-team/dify-agent-local-sandbox"
DEFAULT_LOCAL_MATERIALIZED_HOME_ROOT = "/home/dify"
DEFAULT_LOCAL_WORKSPACE_ROOT = "/workspace"
DEFAULT_LOCAL_HOME_SNAPSHOT_ROOT = "/home/dify/.snapshots"


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
    local_sandbox_rust_endpoint: str | None = None
    local_sandbox_rust_auth_token: str | None = None
    local_sandbox_rust_canary_percent: int = Field(default=0, ge=0, le=100)
    local_sandbox_preflight_timeout_seconds: float = Field(default=1.0, gt=0, le=30)
    local_sandbox_materialized_home_root: str = DEFAULT_LOCAL_MATERIALIZED_HOME_ROOT
    local_sandbox_workspace_root: str = DEFAULT_LOCAL_WORKSPACE_ROOT
    local_sandbox_home_snapshot_root: str = DEFAULT_LOCAL_HOME_SNAPSHOT_ROOT

    enterprise_sandbox_gateway_endpoint: str | None = None
    enterprise_sandbox_gateway_auth_token: str | None = None
    enterprise_sandbox_gateway_timeout: float = Field(default=30.0, gt=0)
    enterprise_sandbox_proxy_timeout: float = Field(default=60.0, gt=0)
    enterprise_sandbox_snapshot_timeout: float = Field(default=35.0, gt=0)

    e2b_api_key: str | None = None
    e2b_template: str = DEFAULT_E2B_TEMPLATE
    e2b_active_timeout_seconds: int = Field(
        default=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
        ge=1,
        le=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
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
                rust_endpoint = self.local_sandbox_rust_endpoint
                if rust_endpoint is not None and rust_endpoint.strip():
                    _validate_http_url(rust_endpoint, field_name="local_sandbox_rust_endpoint")
                    if rust_endpoint.rstrip("/") == self.local_sandbox_endpoint.rstrip("/"):
                        raise ValueError("local_sandbox_rust_endpoint must differ from local_sandbox_endpoint")
                elif self.local_sandbox_rust_canary_percent > 0:
                    raise ValueError(
                        "local_sandbox_rust_endpoint is required when local_sandbox_rust_canary_percent is greater than 0"
                    )
                _validate_absolute_posix_path(
                    self.local_sandbox_materialized_home_root,
                    field_name="local_sandbox_materialized_home_root",
                )
                _validate_absolute_posix_path(
                    self.local_sandbox_workspace_root,
                    field_name="local_sandbox_workspace_root",
                )
                _validate_absolute_posix_path(
                    self.local_sandbox_home_snapshot_root,
                    field_name="local_sandbox_home_snapshot_root",
                )
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
            go_home_snapshots = LocalHomeSnapshotBackend(
                endpoint=endpoint,
                auth_token=token,
                snapshot_root=settings.local_sandbox_home_snapshot_root,
            )
            go_execution_bindings = LocalExecutionBindingBackend(
                endpoint=endpoint,
                auth_token=token,
                materialized_home_root=settings.local_sandbox_materialized_home_root,
                workspace_root=settings.local_sandbox_workspace_root,
                snapshot_root=settings.local_sandbox_home_snapshot_root,
            )
            rust_endpoint = (settings.local_sandbox_rust_endpoint or "").strip()
            if not rust_endpoint:
                return RuntimeBackendProfile(
                    home_snapshots=go_home_snapshots,
                    execution_bindings=go_execution_bindings,
                )

            rust_token = (
                settings.local_sandbox_rust_auth_token if settings.local_sandbox_rust_auth_token is not None else token
            )
            rust_client_factory = create_default_shellctl_client_factory(
                entrypoint=rust_endpoint,
                token=rust_token,
            )
            rust_home_snapshots = LocalHomeSnapshotBackend(
                endpoint=rust_endpoint,
                auth_token=rust_token,
                snapshot_root=settings.local_sandbox_home_snapshot_root,
                client_factory=rust_client_factory,
            )
            rust_execution_bindings = LocalExecutionBindingBackend(
                endpoint=rust_endpoint,
                auth_token=rust_token,
                materialized_home_root=settings.local_sandbox_materialized_home_root,
                workspace_root=settings.local_sandbox_workspace_root,
                snapshot_root=settings.local_sandbox_home_snapshot_root,
                client_factory=rust_client_factory,
            )
            router = LocalRuntimeRouter(
                go=LocalRuntimeTarget(
                    implementation="go",
                    home_snapshots=go_home_snapshots,
                    execution_bindings=go_execution_bindings,
                ),
                rust=LocalRuntimeTarget(
                    implementation="rust",
                    home_snapshots=rust_home_snapshots,
                    execution_bindings=rust_execution_bindings,
                ),
                rust_canary_percent=settings.local_sandbox_rust_canary_percent,
                rust_health_probe=ShellctlHealthProbe(
                    client_factory=rust_client_factory,
                    timeout_seconds=settings.local_sandbox_preflight_timeout_seconds,
                ),
            )
            return RuntimeBackendProfile(
                home_snapshots=RoutedLocalHomeSnapshotBackend(router=router),
                execution_bindings=RoutedLocalExecutionBindingBackend(router=router),
            )
        case "enterprise":
            endpoint = settings.enterprise_sandbox_gateway_endpoint or ""
            token = settings.enterprise_sandbox_gateway_auth_token or ""
            return RuntimeBackendProfile(
                home_snapshots=EnterpriseHomeSnapshotBackend(
                    gateway_endpoint=endpoint,
                    auth_token=token,
                    snapshot_timeout=settings.enterprise_sandbox_snapshot_timeout,
                ),
                execution_bindings=EnterpriseExecutionBindingBackend(
                    gateway_endpoint=endpoint,
                    auth_token=token,
                    gateway_timeout=settings.enterprise_sandbox_gateway_timeout,
                    proxy_timeout=settings.enterprise_sandbox_proxy_timeout,
                    snapshot_timeout=settings.enterprise_sandbox_snapshot_timeout,
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
                    shellctl_port=settings.e2b_shellctl_port,
                ),
            )


def _validate_http_url(value: str, *, field_name: str) -> None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http(s) URL")


def _validate_absolute_posix_path(value: str, *, field_name: str) -> None:
    if not value.strip() or not posixpath.isabs(value):
        raise ValueError(f"{field_name} must be an absolute POSIX path")


__all__ = [
    "DEFAULT_E2B_TEMPLATE",
    "DEFAULT_LOCAL_HOME_SNAPSHOT_ROOT",
    "DEFAULT_LOCAL_MATERIALIZED_HOME_ROOT",
    "DEFAULT_LOCAL_WORKSPACE_ROOT",
    "RuntimeBackendSettings",
    "create_runtime_backend_profile",
]
