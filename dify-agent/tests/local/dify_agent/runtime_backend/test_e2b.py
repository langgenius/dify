from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.runtime_backend import (
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    InitializeHomeSnapshotSpec,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.e2b import (
    E2BExecutionBindingBackend,
    E2BHomeSnapshotBackend,
    E2BRuntimeLease,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease


@dataclass(slots=True)
class _Files:
    paths: set[str] = field(default_factory=set)

    async def make_dir(self, path: str) -> bool:
        self.paths.add(path)
        return True

    async def exists(self, path: str) -> bool:
        return path in self.paths

    async def remove(self, path: str) -> None:
        self.paths.discard(path)


@dataclass(slots=True)
class _Snapshot:
    snapshot_id: str
    names: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _Sandbox:
    sandbox_id: str
    files: _Files = field(default_factory=_Files)
    traffic_access_token: str | None = "traffic-token"
    pauses: list[bool] = field(default_factory=list)
    killed: int = 0
    snapshots: int = 0

    def get_host(self, port: int) -> str:
        return f"{self.sandbox_id}-{port}.example.test"

    async def pause(self, keep_memory: bool = True) -> bool:
        self.pauses.append(keep_memory)
        return True

    async def kill(self) -> bool:
        self.killed += 1
        return True

    async def create_snapshot(self, name: str | None = None) -> _Snapshot:
        del name
        self.snapshots += 1
        return _Snapshot(snapshot_id=f"snapshot-{self.sandbox_id}-{self.snapshots}")


@dataclass(slots=True)
class _ControlPlane:
    created: list[tuple[str, str]] = field(default_factory=list)
    sandboxes: dict[str, _Sandbox] = field(default_factory=dict)
    killed: list[str] = field(default_factory=list)
    deleted_snapshots: list[str] = field(default_factory=list)

    async def create(self, template: str, *, timeout: int, metadata: dict[str, str], on_timeout: str) -> _Sandbox:
        del timeout
        sandbox_id = f"sandbox-{len(self.sandboxes) + 1}"
        sandbox = _Sandbox(sandbox_id=sandbox_id)
        self.sandboxes[sandbox_id] = sandbox
        self.created.append((template, on_timeout))
        assert metadata["dify.resource"] in {"home-snapshot-initialize", "runtime-sandbox"}
        return sandbox

    async def connect(self, handle: str, *, timeout: int) -> _Sandbox:
        del timeout
        return self.sandboxes[handle]

    async def kill(self, handle: str) -> bool:
        self.killed.append(handle)
        return True

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        self.deleted_snapshots.append(snapshot_ref)
        return True


@pytest.mark.anyio
async def test_e2b_profile_uses_snapshot_as_runtime_template_and_couples_refs() -> None:
    control = _ControlPlane()
    snapshots = E2BHomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=3600,
    )
    bindings = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        active_timeout_seconds=3600,
    )

    snapshot_ref = await snapshots.initialize(
        InitializeHomeSnapshotSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-1")
    )
    allocation = await bindings.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=snapshot_ref,
        )
    )

    assert control.created == [("prepared-template", "kill"), (snapshot_ref, "pause")]
    assert allocation.binding_ref == allocation.workspace_ref
    runtime = control.sandboxes[allocation.binding_ref]
    assert runtime.files.paths == {"/home/dify/workspace"}
    assert runtime.pauses == [True]

    await bindings.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=allocation.binding_ref,
            workspace_ref=allocation.workspace_ref,
            destroy_workspace=True,
        )
    )
    await snapshots.delete(snapshot_ref)

    assert control.killed == [allocation.binding_ref]
    assert control.deleted_snapshots == [snapshot_ref]


@pytest.mark.anyio
async def test_e2b_rejects_shared_workspace_and_binding_only_destroy() -> None:
    control = _ControlPlane()
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        active_timeout_seconds=3600,
    )
    spec = ExecutionBindingCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-2",
        binding_id="binding-2",
        workspace_id="workspace-1",
        existing_workspace_ref="sandbox-1",
        home_snapshot_ref="snapshot-1",
    )

    with pytest.raises(SharedWorkspaceUnsupportedError):
        await backend.create_binding(spec)
    with pytest.raises(WorkspacePreservationUnsupportedError):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(binding_ref="sandbox-1", destroy_workspace=False)
        )


@pytest.mark.anyio
async def test_e2b_checkpoint_uses_exact_source_runtime() -> None:
    control = _ControlPlane()
    source_sandbox = _Sandbox(sandbox_id="source")
    source = E2BRuntimeLease(
        sandbox=source_sandbox,
        data_plane=cast(ShellctlRuntimeLease, object()),
    )
    backend = E2BHomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=3600,
    )

    snapshot_ref = await backend.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
        source=source,
    )

    assert snapshot_ref == "snapshot-source-1"
    assert source_sandbox.snapshots == 1
