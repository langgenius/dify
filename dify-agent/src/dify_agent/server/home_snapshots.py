"""Stateless application facade for deployment-owned Home Snapshots."""

from dataclasses import dataclass

from dify_agent.protocol.home_snapshot import (
    CreateHomeSnapshotFromBindingRequest,
    DeleteHomeSnapshotRequest,
    HomeSnapshotResponse,
    InitializeHomeSnapshotRequest,
)
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingLostError,
    ExecutionBindingBackend,
    HomeSnapshotBackend,
    HomeSnapshotCreateError,
    HomeSnapshotCreateSpec,
    HomeSnapshotNotFoundError,
    InitializeHomeSnapshotSpec,
)
from dify_agent.runtime_backend.leases import open_runtime_lease


class HomeSnapshotServiceError(RuntimeError):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class HomeSnapshotService:
    home_snapshots: HomeSnapshotBackend
    execution_bindings: ExecutionBindingBackend

    async def initialize(self, request: InitializeHomeSnapshotRequest) -> HomeSnapshotResponse:
        try:
            snapshot_ref = await self.home_snapshots.initialize(
                InitializeHomeSnapshotSpec(
                    tenant_id=request.tenant_id,
                    agent_id=request.agent_id,
                    home_snapshot_id=request.home_snapshot_id,
                )
            )
        except HomeSnapshotCreateError as exc:
            raise HomeSnapshotServiceError("home_snapshot_create_failed", str(exc), status_code=502) from exc
        return HomeSnapshotResponse(snapshot_ref=snapshot_ref)

    async def create_from_binding(
        self,
        request: CreateHomeSnapshotFromBindingRequest,
    ) -> HomeSnapshotResponse:
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                snapshot_ref = await self.home_snapshots.create_from_runtime(
                    spec=HomeSnapshotCreateSpec(
                        tenant_id=request.tenant_id,
                        agent_id=request.agent_id,
                        home_snapshot_id=request.home_snapshot_id,
                    ),
                    source=lease,
                )
        except BindingLostError as exc:
            raise HomeSnapshotServiceError("binding_lost", str(exc), status_code=404) from exc
        except (BindingAcquireError, HomeSnapshotCreateError) as exc:
            raise HomeSnapshotServiceError("home_snapshot_create_failed", str(exc), status_code=502) from exc
        return HomeSnapshotResponse(snapshot_ref=snapshot_ref)

    async def delete(self, request: DeleteHomeSnapshotRequest) -> None:
        try:
            await self.home_snapshots.delete(request.snapshot_ref)
        except HomeSnapshotNotFoundError:
            return
        except RuntimeError as exc:
            raise HomeSnapshotServiceError("home_snapshot_delete_failed", str(exc), status_code=502) from exc


__all__ = ["HomeSnapshotService", "HomeSnapshotServiceError"]
