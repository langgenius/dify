from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.protocol import (
    CreateHomeSnapshotFromBindingRequest,
    DeleteHomeSnapshotRequest,
    InitializeHomeSnapshotRequest,
)
from dify_agent.runtime_backend import HomeSnapshotCreateSpec, InitializeHomeSnapshotSpec, RuntimeLease
from dify_agent.server.home_snapshots import HomeSnapshotService


@dataclass(slots=True)
class _HomeBackend:
    initialized: list[InitializeHomeSnapshotSpec] = field(default_factory=list)
    checkpointed: list[tuple[HomeSnapshotCreateSpec, RuntimeLease]] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    async def initialize(self, spec: InitializeHomeSnapshotSpec) -> str:
        self.initialized.append(spec)
        return "snapshot-initial"

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        self.checkpointed.append((spec, source))
        return "snapshot-build"

    async def delete(self, snapshot_ref: str) -> None:
        self.deleted.append(snapshot_ref)


@dataclass(slots=True)
class _BindingBackend:
    lease: RuntimeLease
    acquired: list[str] = field(default_factory=list)
    released: list[RuntimeLease] = field(default_factory=list)

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquired.append(binding_ref)
        return self.lease

    async def release(self, lease: RuntimeLease) -> None:
        self.released.append(lease)


@pytest.mark.anyio
async def test_home_snapshot_service_initializes_and_checkpoints_exact_binding() -> None:
    lease = cast(RuntimeLease, object())
    homes = _HomeBackend()
    bindings = _BindingBackend(lease=lease)
    service = HomeSnapshotService(
        home_snapshots=homes,  # pyright: ignore[reportArgumentType]
        execution_bindings=bindings,  # pyright: ignore[reportArgumentType]
    )

    initial = await service.initialize(
        InitializeHomeSnapshotRequest(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-1")
    )
    checkpoint = await service.create_from_binding(
        CreateHomeSnapshotFromBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
            backend_binding_ref="binding-ref",
        )
    )

    assert initial.snapshot_ref == "snapshot-initial"
    assert checkpoint.snapshot_ref == "snapshot-build"
    assert bindings.acquired == ["binding-ref"]
    assert bindings.released == [lease]
    assert homes.checkpointed == [
        (
            HomeSnapshotCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                home_snapshot_id="home-2",
            ),
            lease,
        )
    ]

    await service.delete(DeleteHomeSnapshotRequest(snapshot_ref="snapshot-build"))
    assert homes.deleted == ["snapshot-build"]


@pytest.mark.anyio
async def test_snapshot_checkpoint_releases_binding_when_create_fails() -> None:
    lease = cast(RuntimeLease, object())

    class _FailingHomeBackend(_HomeBackend):
        async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
            del spec, source
            raise RuntimeError("checkpoint failed")

    homes = _FailingHomeBackend()
    bindings = _BindingBackend(lease=lease)
    service = HomeSnapshotService(
        home_snapshots=homes,  # pyright: ignore[reportArgumentType]
        execution_bindings=bindings,  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(RuntimeError, match="checkpoint failed"):
        await service.create_from_binding(
            CreateHomeSnapshotFromBindingRequest(
                tenant_id="tenant-1",
                agent_id="agent-1",
                home_snapshot_id="home-2",
                backend_binding_ref="binding-ref",
            )
        )

    assert bindings.released == [lease]
