from dataclasses import dataclass, field

import pytest

from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from dify_agent.runtime_backend import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
)
from dify_agent.server.execution_bindings import ExecutionBindingService


@dataclass(slots=True)
class _Backend:
    created: list[ExecutionBindingCreateSpec] = field(default_factory=list)
    destroyed: list[ExecutionBindingDestroySpec] = field(default_factory=list)

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        self.created.append(spec)
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
