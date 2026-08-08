"""Public contracts for deployment-selected runtime backends."""

from .errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeSnapshotCreateError,
    HomeSnapshotNotFoundError,
    RuntimeBackendError,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
    WorkspaceUnavailableError,
)
from .protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingBackend,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotBackend,
    HomeSnapshotCreateSpec,
    RuntimeBackendProfile,
    RuntimeLayout,
    RuntimeLease,
)

__all__ = [
    "BindingAcquireError",
    "BindingCreateError",
    "BindingDestroyError",
    "BindingLostError",
    "ExecutionBindingAllocation",
    "ExecutionBindingBackend",
    "ExecutionBindingCreateSpec",
    "ExecutionBindingDestroySpec",
    "HomeSnapshotBackend",
    "HomeSnapshotCreateError",
    "HomeSnapshotCreateSpec",
    "HomeSnapshotNotFoundError",
    "RuntimeBackendError",
    "RuntimeBackendProfile",
    "RuntimeLayout",
    "RuntimeLease",
    "SharedWorkspaceUnsupportedError",
    "WorkspacePreservationUnsupportedError",
    "WorkspaceUnavailableError",
]
