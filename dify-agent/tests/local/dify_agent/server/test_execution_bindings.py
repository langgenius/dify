from dataclasses import dataclass, field

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from dify_agent.runtime_backend import (
    BindingCapacityExhaustedError,
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
)
from dify_agent.server.execution_bindings import ExecutionBindingService
from dify_agent.server.routes.execution_bindings import create_execution_bindings_router


@dataclass(slots=True)
class _Backend:
    created: list[ExecutionBindingCreateSpec] = field(default_factory=list)
    destroyed: list[ExecutionBindingDestroySpec] = field(default_factory=list)
    create_error: Exception | None = None

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        self.created.append(spec)
        if self.create_error is not None:
            raise self.create_error
        return ExecutionBindingAllocation(binding_ref="opaque-binding", workspace_ref="opaque-workspace")

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        self.destroyed.append(spec)


@pytest.mark.anyio
async def test_execution_binding_service_forwards_final_contract() -> None:
    backend = _Backend()
    service = ExecutionBindingService(backend=backend)  # pyright: ignore[reportArgumentType]

    response = await service.create_binding(
        CreateExecutionBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-ref",
        )
    )
    await service.destroy_binding(
        DestroyExecutionBindingRequest(
            binding_ref=response.binding_ref,
            workspace_ref=response.workspace_ref,
            destroy_workspace=True,
        )
    )

    assert backend.created == [
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-ref",
        )
    ]
    assert backend.destroyed == [
        ExecutionBindingDestroySpec(
            binding_ref="opaque-binding",
            workspace_ref="opaque-workspace",
            destroy_workspace=True,
        )
    ]


def test_execution_binding_route_reports_capacity_exhaustion_as_429() -> None:
    backend = _Backend(create_error=BindingCapacityExhaustedError("maximum concurrent sandboxes reached"))
    service = ExecutionBindingService(backend=backend)  # pyright: ignore[reportArgumentType]
    app = FastAPI()
    app.include_router(create_execution_bindings_router(lambda: service))

    with TestClient(app) as client:
        response = client.post(
            "/execution-bindings",
            json={
                "tenant_id": "tenant-1",
                "agent_id": "agent-1",
                "binding_id": "binding-1",
                "workspace_id": "workspace-1",
                "existing_workspace_ref": None,
                "home_snapshot_ref": None,
            },
        )

    assert response.status_code == 429
    assert response.json() == {
        "detail": {
            "code": "binding_capacity_exhausted",
            "message": "maximum concurrent sandboxes reached",
        }
    }
    assert len(backend.created) == 1
