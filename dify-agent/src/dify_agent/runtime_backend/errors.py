"""Stable failures exposed above provider-specific runtime backends."""


class RuntimeBackendError(RuntimeError):
    """Base infrastructure failure for the selected runtime backend."""


class HomeSnapshotCreateError(RuntimeBackendError):
    pass


class HomeSnapshotNotFoundError(RuntimeBackendError):
    pass


class HomeSnapshotTooLargeError(RuntimeBackendError):
    pass


class BindingCreateError(RuntimeBackendError):
    pass


class BindingAcquireError(RuntimeBackendError):
    pass


class BindingLostError(RuntimeBackendError):
    pass


class BindingDestroyError(RuntimeBackendError):
    pass


class SharedWorkspaceUnsupportedError(RuntimeBackendError):
    pass


class WorkspacePreservationUnsupportedError(RuntimeBackendError):
    pass


class WorkspaceUnavailableError(RuntimeBackendError):
    pass


__all__ = [
    "BindingAcquireError",
    "BindingCreateError",
    "BindingDestroyError",
    "BindingLostError",
    "HomeSnapshotCreateError",
    "HomeSnapshotNotFoundError",
    "HomeSnapshotTooLargeError",
    "RuntimeBackendError",
    "SharedWorkspaceUnsupportedError",
    "WorkspacePreservationUnsupportedError",
    "WorkspaceUnavailableError",
]
