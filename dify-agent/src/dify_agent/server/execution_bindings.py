"""Stateless application facade for Execution Binding lifecycle operations."""

from dataclasses import dataclass

from dify_agent.protocol import (
    CreateExecutionBindingRequest,
    CreateExecutionBindingResponse,
    DestroyExecutionBindingRequest,
)
from dify_agent.runtime_backend import (
    BindingCreateError,
    BindingDestroyError,
    ExecutionBindingBackend,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)


class ExecutionBindingServiceError(RuntimeError):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class ExecutionBindingService:
    backend: ExecutionBindingBackend

    async def create_binding(self, request: CreateExecutionBindingRequest) -> CreateExecutionBindingResponse:
        try:
            allocation = await self.backend.create_binding(
                ExecutionBindingCreateSpec(
                    tenant_id=request.tenant_id,
                    agent_id=request.agent_id,
                    binding_id=request.binding_id,
                    workspace_id=request.workspace_id,
                    existing_workspace_ref=request.existing_workspace_ref,
                    home_snapshot_ref=request.home_snapshot_ref,
                )
            )
        except SharedWorkspaceUnsupportedError as exc:
            raise ExecutionBindingServiceError("shared_workspace_unsupported", str(exc), status_code=409) from exc
        except BindingCreateError as exc:
            raise ExecutionBindingServiceError("binding_create_failed", str(exc), status_code=502) from exc
        return CreateExecutionBindingResponse(
            binding_ref=allocation.binding_ref,
            workspace_ref=allocation.workspace_ref,
        )

    async def destroy_binding(self, request: DestroyExecutionBindingRequest) -> None:
        try:
            await self.backend.destroy_binding(
                ExecutionBindingDestroySpec(
                    binding_ref=request.binding_ref,
                    destroy_workspace=request.destroy_workspace,
                    workspace_ref=request.workspace_ref,
                )
            )
        except WorkspacePreservationUnsupportedError as exc:
            raise ExecutionBindingServiceError(
                "workspace_preservation_unsupported", str(exc), status_code=409
            ) from exc
        except BindingDestroyError as exc:
            raise ExecutionBindingServiceError("binding_destroy_failed", str(exc), status_code=502) from exc


__all__ = ["ExecutionBindingService", "ExecutionBindingServiceError"]
