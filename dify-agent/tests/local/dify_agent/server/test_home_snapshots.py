from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.protocol import (
    CreateHomeSnapshotFromBindingRequest,
    DeleteHomeSnapshotRequest,
)
from dify_agent.runtime_backend import HomeSnapshotCreateSpec, RuntimeLease
from dify_agent.server.home_snapshots import HomeSnapshotService


@dataclass(slots=True)
class _HomeBackend:
    checkpointed: list[tuple[HomeSnapshotCreateSpec, RuntimeLease]] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

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
async def test_home_snapshot_service_checkpoints_exact_binding() -> None:
    lease = cast(RuntimeLease, object())
    homes = _HomeBackend()
    bindings = _BindingBackend(lease=lease)
    service = HomeSnapshotService(
        home_snapshots=homes,  # pyright: ignore[reportArgumentType]
        execution_bindings=bindings,  # pyright: ignore[reportArgumentType]
    )

    checkpoint = await service.create_from_binding(
        CreateHomeSnapshotFromBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
            backend_binding_ref="binding-ref",
        )
    )

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


@pytest.mark.anyio
async def test_home_snapshot_service_reports_unsupported_as_null() -> None:
    """A noop backend returns the explicit null; the source lease is still
    acquired/released so exact-binding validation stays enforced."""
    from dify_agent.runtime_backend.noop import NoopHomeSnapshotBackend

    lease = cast(RuntimeLease, object())
    bindings = _BindingBackend(lease=lease)
    service = HomeSnapshotService(
        home_snapshots=NoopHomeSnapshotBackend(),  # pyright: ignore[reportArgumentType]
        execution_bindings=bindings,  # pyright: ignore[reportArgumentType]
    )

    checkpoint = await service.create_from_binding(
        CreateHomeSnapshotFromBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
            backend_binding_ref="binding-ref",
        )
    )

    assert checkpoint.snapshot_ref is None
    assert checkpoint.model_dump() == {"snapshot_ref": None}
    assert bindings.acquired == ["binding-ref"]
    assert bindings.released == [lease]
    # No I/O against the lease: delete accepts any ref without error.
    await service.delete(DeleteHomeSnapshotRequest(snapshot_ref="stale-ref"))


def test_home_snapshot_response_requires_explicit_nullable_ref() -> None:
    from pydantic import ValidationError

    from dify_agent.protocol import HomeSnapshotResponse

    assert HomeSnapshotResponse(snapshot_ref=None).model_dump() == {"snapshot_ref": None}
    assert HomeSnapshotResponse(snapshot_ref="ref-1").snapshot_ref == "ref-1"
    with pytest.raises(ValidationError):
        HomeSnapshotResponse(snapshot_ref="")
    with pytest.raises(ValidationError):
        HomeSnapshotResponse()  # type: ignore[call-arg]


@pytest.mark.parametrize("snapshot_ref", [None, "snapshot-build"])
def test_home_snapshots_route_serializes_nullable_ref(snapshot_ref: str | None) -> None:
    """ASGI boundary: FastAPI must emit explicit null, not drop the field, and
    keep the nonnull string path unchanged."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from dify_agent.runtime_backend.noop import NoopHomeSnapshotBackend
    from dify_agent.server.routes.home_snapshots import create_home_snapshots_router

    lease = cast(RuntimeLease, object())
    bindings = _BindingBackend(lease=lease)
    service = HomeSnapshotService(
        home_snapshots=NoopHomeSnapshotBackend() if snapshot_ref is None else _HomeBackend(),
        execution_bindings=bindings,  # pyright: ignore[reportArgumentType]
    )
    app = FastAPI()
    app.include_router(create_home_snapshots_router(lambda: service))
    client = TestClient(app)

    response = client.post(
        "/home-snapshots/from-binding",
        json={
            "tenant_id": "tenant-1",
            "agent_id": "agent-1",
            "home_snapshot_id": "home-2",
            "backend_binding_ref": "binding-ref",
        },
    )

    assert response.status_code == 201
    assert response.json() == {"snapshot_ref": snapshot_ref}
