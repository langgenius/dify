"""Enterprise backend boundary for the final working-environment protocol.

The current Enterprise Gateway still implements the retired Sandbox contract.
The deployment may be configured, but operations fail explicitly until the
Gateway adopts Execution Binding and Workspace refs; no compatibility adapter
or fallback is provided.
"""

from dataclasses import dataclass

from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    InitializeHomeSnapshotSpec,
    RuntimeLease,
)


def _not_implemented() -> NotImplementedError:
    return NotImplementedError("Enterprise Gateway does not implement the Execution Binding protocol")


@dataclass(slots=True)
class EnterpriseHomeSnapshotBackend:
    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0

    async def initialize(self, spec: InitializeHomeSnapshotSpec) -> str:
        del spec
        raise _not_implemented()

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        del spec, source
        raise _not_implemented()

    async def delete(self, snapshot_ref: str) -> None:
        del snapshot_ref
        raise _not_implemented()


@dataclass(slots=True)
class EnterpriseExecutionBindingBackend:
    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0
    proxy_timeout: float = 60.0

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        del spec
        raise _not_implemented()

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        del binding_ref
        raise _not_implemented()

    async def release(self, lease: RuntimeLease) -> None:
        del lease
        raise _not_implemented()

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        del spec
        raise _not_implemented()


__all__ = ["EnterpriseExecutionBindingBackend", "EnterpriseHomeSnapshotBackend"]
