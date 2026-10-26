"""Stateless application facade for Execution Binding lifecycle operations."""

from dataclasses import dataclass

from shellctl.client import ShellctlClientError

from dify_agent.protocol import (
    CreateExecutionBindingRequest,
    CreateExecutionBindingResponse,
    DestroyExecutionBindingRequest,
    KeepAliveExecutionBindingRequest,
    KeepAliveExecutionBindingResponse,
    ReadExecutionBindingJobRequest,
    ReadExecutionBindingJobResponse,
)
from dify_agent.runtime_backend import (
    BindingCapacityExhaustedError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    ExecutionBindingBackend,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend


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
        if request.native_test_scope is not None and not isinstance(self.backend, LocalExecutionBindingBackend):
            raise ExecutionBindingServiceError(
                "native_scope_unavailable", "Backend has no enforcing native scope", status_code=409
            )
        try:
            allocation = await self.backend.create_binding(
                ExecutionBindingCreateSpec(
                    tenant_id=request.tenant_id,
                    agent_id=request.agent_id,
                    binding_id=request.binding_id,
                    workspace_id=request.workspace_id,
                    existing_workspace_ref=request.existing_workspace_ref,
                    home_snapshot_ref=request.home_snapshot_ref,
                    native_test_scope=request.native_test_scope,
                    native_scope_reconcile=request.native_scope_reconcile,
                )
            )
        except SharedWorkspaceUnsupportedError as exc:
            raise ExecutionBindingServiceError("shared_workspace_unsupported", str(exc), status_code=409) from exc
        except BindingCapacityExhaustedError as exc:
            raise ExecutionBindingServiceError("binding_capacity_exhausted", str(exc), status_code=429) from exc
        except BindingCreateError as exc:
            raise ExecutionBindingServiceError("binding_create_failed", str(exc), status_code=502) from exc
        return CreateExecutionBindingResponse(
            binding_ref=allocation.binding_ref,
            workspace_ref=allocation.workspace_ref,
        )

    async def read_job(self, request: ReadExecutionBindingJobRequest) -> ReadExecutionBindingJobResponse:
        """Expose only coherent job evidence from supported direct read connections."""
        if not isinstance(self.backend, (LocalExecutionBindingBackend, EnterpriseExecutionBindingBackend)) or (
            request.binding_ref.startswith("native:")
        ):
            raise ExecutionBindingServiceError(
                "binding_job_status_unsupported", "job status unsupported", status_code=409
            )
        try:
            result = await self.backend.read_job_status(request.binding_ref, request.job_id)
            if result.job_id != request.job_id:
                raise ValueError("job identity mismatch")
            return ReadExecutionBindingJobResponse.model_validate(
                {"job_id": result.job_id, "status": result.status, "done": result.done, "exit_code": result.exit_code}
            )
        except ShellctlClientError as error:
            if error.status_code == 404:
                raise ExecutionBindingServiceError(
                    "binding_job_not_found", "job unavailable", status_code=404
                ) from None
            raise ExecutionBindingServiceError(
                "binding_job_status_failed", "job status unavailable", status_code=502
            ) from None
        except Exception:
            raise ExecutionBindingServiceError(
                "binding_job_status_failed", "job status unavailable", status_code=502
            ) from None

    async def keep_alive(self, request: KeepAliveExecutionBindingRequest) -> KeepAliveExecutionBindingResponse:
        """Refresh one supported existing binding without allocating or running a job."""
        if not isinstance(self.backend, EnterpriseExecutionBindingBackend):
            return KeepAliveExecutionBindingResponse(supported=False)
        try:
            await self.backend.keep_alive(request.binding_ref)
        except BindingLostError:
            raise ExecutionBindingServiceError("binding_lost", "binding unavailable", status_code=410) from None
        except Exception:
            raise ExecutionBindingServiceError(
                "binding_keep_alive_failed", "binding health unavailable", status_code=502
            ) from None
        return KeepAliveExecutionBindingResponse(supported=True)

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
            raise ExecutionBindingServiceError("workspace_preservation_unsupported", str(exc), status_code=409) from exc
        except BindingDestroyError as exc:
            raise ExecutionBindingServiceError("binding_destroy_failed", str(exc), status_code=502) from exc


__all__ = ["ExecutionBindingService", "ExecutionBindingServiceError"]
