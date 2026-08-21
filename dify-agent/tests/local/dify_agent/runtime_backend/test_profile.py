from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from dify_agent.runtime_backend.e2b import E2B_MAX_ACTIVE_TIMEOUT_SECONDS
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend
from dify_agent.runtime_backend.openshell import (
    OpenShellExecutionBindingBackend,
    OpenShellHomeSnapshotBackend,
    OpenShellSDKControlPlane,
)
from dify_agent.runtime_backend.profile import (
    DEFAULT_E2B_TEMPLATE,
    RuntimeBackendSettings,
    create_runtime_backend_profile,
)


@pytest.fixture(autouse=True)
def _isolated_backend_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # RuntimeBackendSettings reads the process environment, so a developer's
    # exported DIFY_AGENT_* / E2B_* values must not leak into these tests.
    for name in list(os.environ):
        if name.startswith("DIFY_AGENT_") or name in ("E2B_API_KEY", "E2B_API_TOKEN"):
            monkeypatch.delenv(name)


def test_e2b_backend_uses_prepared_dify_template_and_one_hour_lease_by_default() -> None:
    settings = RuntimeBackendSettings(runtime_backend="e2b", e2b_api_key="secret")

    assert settings.e2b_template == "difys-default-team/dify-agent-local-sandbox"
    assert settings.e2b_template == DEFAULT_E2B_TEMPLATE
    assert E2B_MAX_ACTIVE_TIMEOUT_SECONDS == 60 * 60
    assert settings.e2b_active_timeout_seconds == E2B_MAX_ACTIVE_TIMEOUT_SECONDS


def test_e2b_backend_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="e2b_api_key"):
        _ = RuntimeBackendSettings(runtime_backend="e2b")


def test_e2b_backend_rejects_active_timeout_above_platform_limit() -> None:
    with pytest.raises(ValidationError, match="less than or equal"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b",
            e2b_api_key="secret",
            e2b_active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS + 1,
        )


def test_local_backend_requires_shellctl_endpoint() -> None:
    with pytest.raises(ValidationError, match="local_sandbox_endpoint"):
        _ = RuntimeBackendSettings(runtime_backend="local")


def test_local_backend_uses_root_workspace_directory_by_default() -> None:
    settings = RuntimeBackendSettings(
        runtime_backend="local",
        local_sandbox_endpoint="http://shellctl.example",
    )

    profile = create_runtime_backend_profile(settings)

    assert settings.local_sandbox_workspace_root == "/workspace"
    assert isinstance(profile.execution_bindings, LocalExecutionBindingBackend)
    assert profile.execution_bindings.workspace_root == "/workspace"


def test_local_backend_passes_configured_roots_to_drivers() -> None:
    settings = RuntimeBackendSettings(
        runtime_backend="local",
        local_sandbox_endpoint="http://shellctl.example",
        local_sandbox_materialized_home_root="/tmp/dify/homes",
        local_sandbox_workspace_root="/tmp/dify/workspaces",
        local_sandbox_home_snapshot_root="/tmp/dify/snapshots",
    )

    profile = create_runtime_backend_profile(settings)

    assert isinstance(profile.execution_bindings, LocalExecutionBindingBackend)
    assert isinstance(profile.home_snapshots, LocalHomeSnapshotBackend)
    assert profile.execution_bindings.materialized_home_root == "/tmp/dify/homes"
    assert profile.execution_bindings.workspace_root == "/tmp/dify/workspaces"
    assert profile.execution_bindings.snapshot_root == "/tmp/dify/snapshots"
    assert profile.home_snapshots.snapshot_root == "/tmp/dify/snapshots"


def test_local_backend_rejects_relative_roots() -> None:
    with pytest.raises(ValidationError, match="absolute POSIX path"):
        _ = RuntimeBackendSettings(
            runtime_backend="local",
            local_sandbox_endpoint="http://shellctl.example",
            local_sandbox_workspace_root="relative/workspaces",
        )


_OPENSHELL_DRIVER_CONFIG = (
    '{"docker": {"mounts": [{"type": "volume", "source": "dify-agent-shared",'
    ' "target": "/mnt/dify-agent-shared"}]}}'
)


def test_openshell_backend_requires_gateway_endpoint_and_driver_config() -> None:
    with pytest.raises(ValidationError, match="openshell_gateway_endpoint"):
        _ = RuntimeBackendSettings(runtime_backend="openshell")
    with pytest.raises(ValidationError, match="openshell_driver_config"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
        )


def test_openshell_backend_rejects_invalid_driver_config_json() -> None:
    with pytest.raises(ValidationError, match="valid JSON"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config="not-json",
        )
    with pytest.raises(ValidationError, match="JSON object"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config='["a-list"]',
        )


def test_openshell_backend_rejects_empty_driver_config_object() -> None:
    with pytest.raises(ValidationError, match="must mount the shared Home Snapshot volume"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config="{}",
            openshell_shellctl_auth_token="token-1",
        )


def test_openshell_backend_requires_shellctl_auth_token() -> None:
    with pytest.raises(ValidationError, match="openshell_shellctl_auth_token"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
        )


def test_openshell_backend_requires_paired_tls_client_material() -> None:
    with pytest.raises(ValidationError, match="set together"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
            openshell_shellctl_auth_token="token-1",
            openshell_tls_client_cert_path="/etc/dify/tls.crt",
        )
    # Compose injects "" for unset variables; blank must count as unset so a
    # half-configured pair still fails at startup validation.
    with pytest.raises(ValidationError, match="set together"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
            openshell_shellctl_auth_token="token-1",
            openshell_tls_client_cert_path="/etc/dify/tls.crt",
            openshell_tls_client_key_path="",
        )


def test_openshell_backend_rejects_relative_shared_mount_path() -> None:
    with pytest.raises(ValidationError, match="absolute POSIX path"):
        _ = RuntimeBackendSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
            openshell_shellctl_auth_token="token-1",
            openshell_shared_mount_path="relative/shared",
        )


def test_openshell_backend_wires_shared_deployment_config_into_both_drivers() -> None:
    settings = RuntimeBackendSettings(
        runtime_backend="openshell",
        openshell_gateway_endpoint="gateway.example:17670",
        openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
        openshell_shared_mount_path="/mnt/shared",
        openshell_shellctl_auth_token="token-1",
        openshell_shellctl_port=6006,
    )

    profile = create_runtime_backend_profile(settings)

    assert isinstance(profile.execution_bindings, OpenShellExecutionBindingBackend)
    assert isinstance(profile.home_snapshots, OpenShellHomeSnapshotBackend)
    control_plane = profile.execution_bindings.control_plane
    assert isinstance(control_plane, OpenShellSDKControlPlane)
    assert control_plane.endpoint == "gateway.example:17670"
    assert control_plane.driver_config == {
        "docker": {
            "mounts": [{"type": "volume", "source": "dify-agent-shared", "target": "/mnt/dify-agent-shared"}]
        }
    }
    assert control_plane.shared_mount_path == "/mnt/shared"
    assert profile.home_snapshots.control_plane is control_plane
    assert profile.home_snapshots.shared_mount_path == "/mnt/shared"
    assert profile.execution_bindings.shared_mount_path == "/mnt/shared"
    assert profile.execution_bindings.shellctl_auth_token == "token-1"
    assert profile.execution_bindings.shellctl_port == 6006
