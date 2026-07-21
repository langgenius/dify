from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.home import DifyHomeLayer, DifyHomeLayerConfig
from dify_agent.layers.sandbox import DifySandboxLayer, DifySandboxLayerConfig, DifySandboxRuntimeState
from dify_agent.layers.workspace import DifyWorkspaceLayer, DifyWorkspaceLayerConfig
from dify_agent.runtime_backend import FileSystem, SandboxCreateSpec, SandboxLayout, SandboxLease


@dataclass(slots=True)
class _Lease:
    handle: str
    layout: SandboxLayout = field(
        default_factory=lambda: SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )
    commands: ShellCommandProtocol = field(default_factory=lambda: cast(ShellCommandProtocol, object()))
    files: FileSystem = field(default_factory=lambda: cast(FileSystem, object()))


@dataclass(slots=True)
class _Driver:
    lease: _Lease = field(default_factory=lambda: _Lease(handle="sandbox-1"))
    create_specs: list[SandboxCreateSpec] = field(default_factory=list)
    resumed: list[str] = field(default_factory=list)
    suspended: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    suspend_error: BaseException | None = None
    delete_error: BaseException | None = None

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        self.create_specs.append(spec)
        return self.lease

    async def resume(self, handle: str) -> SandboxLease:
        self.resumed.append(handle)
        return self.lease

    async def suspend(self, lease: SandboxLease) -> None:
        self.suspended.append(lease.handle)
        if self.suspend_error is not None:
            raise self.suspend_error

    async def delete(self, handle: str) -> None:
        self.deleted.append(handle)
        if self.delete_error is not None:
            raise self.delete_error


def _execution_context() -> DifyExecutionContextLayer:
    return DifyExecutionContextLayer.from_config_with_settings(
        DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_version_id="version-1",
            agent_mode="agent_app",
            invoke_from="service-api",
        ),
        daemon_url="http://plugin-daemon",
        daemon_api_key="test-key",
    )


def _resource_layers() -> tuple[DifyHomeLayer, DifyWorkspaceLayer]:
    home = DifyHomeLayer.from_config(DifyHomeLayerConfig(snapshot_ref="home-1"))
    workspace = DifyWorkspaceLayer.from_config(DifyWorkspaceLayerConfig(workspace_id="runtime-session-1"))
    home.bind_deps({"execution_context": _execution_context()})
    workspace.bind_deps({"execution_context": _execution_context()})
    return home, workspace


def test_home_and_workspace_layers_only_bind_stable_identity() -> None:
    home, workspace = _resource_layers()

    assert home.binding.snapshot_ref == "home-1"
    assert workspace.binding.workspace_id == "runtime-session-1"
    assert home.runtime_state.model_dump() == {}
    assert workspace.runtime_state.model_dump() == {}


def test_sandbox_layer_creates_from_bindings_and_suspends() -> None:
    home, workspace = _resource_layers()
    driver = _Driver()
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps(
        {
            "execution_context": _execution_context(),
            "home": home,
            "workspace": workspace,
        }
    )

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()
            assert layer.lease.handle == "sandbox-1"

    asyncio.run(scenario())

    assert driver.create_specs == [
        SandboxCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_version_id="version-1",
            runtime_session_id="runtime-session-1",
            home_snapshot_ref="home-1",
        )
    ]
    assert layer.runtime_state == DifySandboxRuntimeState(handle="sandbox-1")
    assert driver.suspended == ["sandbox-1"]
    assert driver.deleted == []


def test_sandbox_layer_resumes_and_delete_is_terminal() -> None:
    home, workspace = _resource_layers()
    driver = _Driver()
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps(
        {
            "execution_context": _execution_context(),
            "home": home,
            "workspace": workspace,
        }
    )
    layer.runtime_state = DifySandboxRuntimeState(handle="sandbox-1")

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_resume()
            await layer.on_context_delete()

    asyncio.run(scenario())

    assert driver.resumed == ["sandbox-1"]
    assert driver.deleted == ["sandbox-1"]
    assert driver.suspended == ["sandbox-1"]
    assert layer.runtime_state.handle is None


def test_sandbox_layer_releases_lease_when_resume_returns_different_handle() -> None:
    home, workspace = _resource_layers()
    driver = _Driver(lease=_Lease(handle="different-sandbox"))
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps(
        {
            "execution_context": _execution_context(),
            "home": home,
            "workspace": workspace,
        }
    )
    layer.runtime_state = DifySandboxRuntimeState(handle="sandbox-1")

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="preserve the stable sandbox handle"):
            async with layer.resource_context():
                pytest.fail("a mismatched lease must not enter the layer context")

    asyncio.run(scenario())

    assert driver.resumed == ["sandbox-1"]
    assert driver.suspended == ["different-sandbox"]
    assert driver.deleted == []
    assert layer.runtime_state.handle == "sandbox-1"


def test_sandbox_layer_preserves_hook_error_when_release_also_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    home, workspace = _resource_layers()
    driver = _Driver(suspend_error=RuntimeError("release failed"))
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps(
        {
            "execution_context": _execution_context(),
            "home": home,
            "workspace": workspace,
        }
    )

    async def scenario() -> None:
        with pytest.raises(ValueError, match="hook failed"):
            async with layer.resource_context():
                raise ValueError("hook failed")

    with caplog.at_level("WARNING", logger="dify_agent.layers.sandbox.layer"):
        asyncio.run(scenario())

    assert driver.suspended == ["sandbox-1"]
    assert driver.deleted == []
    assert "release failed" in caplog.text


def test_sandbox_layer_delete_attempts_release_and_delete_and_preserves_delete_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    home, workspace = _resource_layers()
    driver = _Driver(
        suspend_error=RuntimeError("release failed"),
        delete_error=RuntimeError("delete failed"),
    )
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps(
        {
            "execution_context": _execution_context(),
            "home": home,
            "workspace": workspace,
        }
    )
    layer.runtime_state = DifySandboxRuntimeState(handle="sandbox-1")

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="delete failed"):
            async with layer.resource_context():
                await layer.on_context_delete()

    with caplog.at_level("WARNING", logger="dify_agent.layers.sandbox.layer"):
        asyncio.run(scenario())

    assert driver.suspended == ["sandbox-1"]
    assert driver.deleted == ["sandbox-1"]
    assert layer.runtime_state.handle == "sandbox-1"
    assert "release failed" in caplog.text


def test_sandbox_layer_cancellation_releases_lease_and_is_not_wrapped() -> None:
    home, workspace = _resource_layers()
    driver = _Driver()
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps({"execution_context": _execution_context(), "home": home, "workspace": workspace})

    async def scenario() -> None:
        with pytest.raises(asyncio.CancelledError):
            async with layer.resource_context():
                raise asyncio.CancelledError

    asyncio.run(scenario())

    assert driver.suspended == ["sandbox-1"]
    assert driver.deleted == []


def test_sandbox_layer_delete_during_cancellation_releases_and_deletes() -> None:
    home, workspace = _resource_layers()
    driver = _Driver()
    layer = DifySandboxLayer.from_config_with_driver(DifySandboxLayerConfig(), driver=driver)
    layer.bind_deps({"execution_context": _execution_context(), "home": home, "workspace": workspace})
    layer.runtime_state = DifySandboxRuntimeState(handle="sandbox-1")

    async def scenario() -> None:
        with pytest.raises(asyncio.CancelledError):
            async with layer.resource_context():
                await layer.on_context_delete()
                raise asyncio.CancelledError

    asyncio.run(scenario())

    assert driver.suspended == ["sandbox-1"]
    assert driver.deleted == ["sandbox-1"]
    assert layer.runtime_state.handle is None
