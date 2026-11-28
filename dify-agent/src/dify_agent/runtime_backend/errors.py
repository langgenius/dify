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


class BindingCapacityExhaustedError(BindingCreateError):
    """The selected runtime backend cannot allocate another Binding."""


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


class PortEntrypointUnsupportedError(RuntimeBackendError):
    """The backend cannot expose sandbox ports to the agent process."""


__all__ = [
    "BindingAcquireError",
    "BindingCapacityExhaustedError",
    "BindingCreateError",
    "BindingDestroyError",
    "BindingLostError",
    "HomeSnapshotCreateError",
    "HomeSnapshotNotFoundError",
    "HomeSnapshotTooLargeError",
    "PortEntrypointUnsupportedError",
    "RuntimeBackendError",
    "SharedWorkspaceUnsupportedError",
    "WorkspacePreservationUnsupportedError",
    "WorkspaceUnavailableError",
]
