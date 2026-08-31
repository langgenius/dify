"""Deployment-selected coherent runtime backend profile construction."""

from __future__ import annotations

import json
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
from dify_agent.runtime_backend.openshell import (
    DEFAULT_OPENSHELL_SANDBOX_IMAGE,
    DEFAULT_OPENSHELL_SHARED_MOUNT_PATH,
    OpenShellExecutionBindingBackend,
    OpenShellHomeSnapshotBackend,
    OpenShellSDKControlPlane,
)
from dify_agent.runtime_backend.protocols import RuntimeBackendProfile

DEFAULT_E2B_TEMPLATE = "difys-default-team/dify-agent-local-sandbox"
DEFAULT_LOCAL_MATERIALIZED_HOME_ROOT = "/home/dify"
DEFAULT_LOCAL_WORKSPACE_ROOT = "/workspace"
DEFAULT_LOCAL_HOME_SNAPSHOT_ROOT = "/home/dify/.snapshots"


class RuntimeBackendSettings(BaseSettings):
    """Server-private credentials and endpoints for one coherent backend profile."""

    runtime_backend: Literal["local", "enterprise", "e2b", "openshell"] = "local"

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

    openshell_gateway_endpoint: str | None = None
    openshell_workspace: str = "default"
    openshell_bearer_token: str | None = None
    openshell_tls_ca_path: str | None = None
    openshell_tls_client_cert_path: str | None = None
    openshell_tls_client_key_path: str | None = None
    openshell_insecure: bool = False
    openshell_sandbox_image: str = DEFAULT_OPENSHELL_SANDBOX_IMAGE
    openshell_driver_config: str | None = None
    openshell_shared_mount_path: str = DEFAULT_OPENSHELL_SHARED_MOUNT_PATH
    openshell_egress_allow: str = ""
    openshell_shellctl_auth_token: str = ""
    openshell_shellctl_port: int = Field(default=5004, ge=1, le=65535)
    openshell_ready_timeout_seconds: float = Field(default=300.0, gt=0)
    openshell_exec_timeout_seconds: int = Field(default=120, ge=1)

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
            case "openshell":
                if not self.openshell_gateway_endpoint or not self.openshell_gateway_endpoint.strip():
                    raise ValueError("openshell_gateway_endpoint is required for the openshell runtime backend")
                if not self.openshell_driver_config or not self.openshell_driver_config.strip():
                    raise ValueError(
                        "openshell_driver_config is required for the openshell runtime backend: "
                        "it must mount the shared Home Snapshot volume into every sandbox"
                    )
                _ = _parse_openshell_driver_config(self.openshell_driver_config)
                _ = _parse_openshell_egress_allow(self.openshell_egress_allow)
                if not self.openshell_shellctl_auth_token.strip():
                    raise ValueError(
                        "openshell_shellctl_auth_token is required for the openshell runtime backend"
                    )
                _validate_absolute_posix_path(
                    self.openshell_shared_mount_path,
                    field_name="openshell_shared_mount_path",
                )
                if not self.openshell_sandbox_image.strip():
                    raise ValueError("openshell_sandbox_image must not be blank")
                # Compose injects empty strings for unset variables; treat
                # blank and None alike so a half-configured mTLS pair fails
                # here instead of at the first gateway call.
                cert_path = (self.openshell_tls_client_cert_path or "").strip()
                key_path = (self.openshell_tls_client_key_path or "").strip()
                if bool(cert_path) != bool(key_path):
                    raise ValueError(
                        "openshell_tls_client_cert_path and openshell_tls_client_key_path must be set together"
                    )
        return self


def create_runtime_backend_profile(settings: RuntimeBackendSettings) -> RuntimeBackendProfile:
    """Construct one driver pair selected exclusively by server deployment settings."""
    match settings.runtime_backend:
        case "local":
            endpoint = settings.local_sandbox_endpoint or ""
            token = settings.local_sandbox_auth_token or ""
            return RuntimeBackendProfile(
                home_snapshots=LocalHomeSnapshotBackend(
                    endpoint=endpoint,
                    auth_token=token,
                    snapshot_root=settings.local_sandbox_home_snapshot_root,
                ),
                execution_bindings=LocalExecutionBindingBackend(
                    endpoint=endpoint,
                    auth_token=token,
                    materialized_home_root=settings.local_sandbox_materialized_home_root,
                    workspace_root=settings.local_sandbox_workspace_root,
                    snapshot_root=settings.local_sandbox_home_snapshot_root,
                ),
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
        case "openshell":
            openshell_control_plane = OpenShellSDKControlPlane(
                endpoint=(settings.openshell_gateway_endpoint or "").strip(),
                workspace=settings.openshell_workspace,
                bearer_token=settings.openshell_bearer_token or None,
                tls_ca_path=settings.openshell_tls_ca_path or None,
                tls_client_cert_path=settings.openshell_tls_client_cert_path or None,
                tls_client_key_path=settings.openshell_tls_client_key_path or None,
                insecure=settings.openshell_insecure,
                image=settings.openshell_sandbox_image,
                driver_config=_parse_openshell_driver_config(settings.openshell_driver_config or ""),
                shared_mount_path=settings.openshell_shared_mount_path,
                egress_allow=_parse_openshell_egress_allow(settings.openshell_egress_allow),
                ready_timeout_seconds=settings.openshell_ready_timeout_seconds,
                exec_timeout_seconds=settings.openshell_exec_timeout_seconds,
            )
            return RuntimeBackendProfile(
                home_snapshots=OpenShellHomeSnapshotBackend(
                    control_plane=openshell_control_plane,
                    shared_mount_path=settings.openshell_shared_mount_path,
                ),
                execution_bindings=OpenShellExecutionBindingBackend(
                    control_plane=openshell_control_plane,
                    shellctl_auth_token=settings.openshell_shellctl_auth_token,
                    shellctl_port=settings.openshell_shellctl_port,
                    shared_mount_path=settings.openshell_shared_mount_path,
                ),
            )


def _validate_http_url(value: str, *, field_name: str) -> None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http(s) URL")


def _validate_absolute_posix_path(value: str, *, field_name: str) -> None:
    if not value.strip() or not posixpath.isabs(value):
        raise ValueError(f"{field_name} must be an absolute POSIX path")


def _parse_openshell_egress_allow(value: str) -> tuple[tuple[str, int], ...]:
    """Parse a comma-separated ``host:port`` list into ``(host, port)`` pairs."""
    endpoints: list[tuple[str, int]] = []
    for raw_entry in value.split(","):
        entry = raw_entry.strip()
        if not entry:
            continue
        host, _, port_text = entry.rpartition(":")
        if not host or "/" in entry or not port_text.isdigit() or not 1 <= int(port_text) <= 65535:
            raise ValueError(
                f"openshell_egress_allow entries must be host:port (no scheme or path), got: {entry!r}"
            )
        endpoints.append((host, int(port_text)))
    return tuple(endpoints)


def _parse_openshell_driver_config(value: str) -> dict[str, object]:
    try:
        parsed: object = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("openshell_driver_config must be valid JSON") from exc
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError(
            "openshell_driver_config must be a non-empty JSON object that "
            "must mount the shared Home Snapshot volume"
        )
    return {str(key): item for key, item in parsed.items()}


__all__ = [
    "DEFAULT_E2B_TEMPLATE",
    "DEFAULT_LOCAL_HOME_SNAPSHOT_ROOT",
    "DEFAULT_LOCAL_MATERIALIZED_HOME_ROOT",
    "DEFAULT_LOCAL_WORKSPACE_ROOT",
    "RuntimeBackendSettings",
    "create_runtime_backend_profile",
]
