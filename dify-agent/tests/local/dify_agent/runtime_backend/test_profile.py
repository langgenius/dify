from __future__ import annotations

import pytest
from pydantic import ValidationError

from dify_agent.runtime_backend.e2b import E2B_MAX_ACTIVE_TIMEOUT_SECONDS
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend
from dify_agent.runtime_backend.profile import (
    DEFAULT_E2B_TEMPLATE,
    RuntimeBackendSettings,
    create_runtime_backend_profile,
)


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
