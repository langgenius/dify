"""Stable failures exposed above provider-specific runtime backends."""


class RuntimeBackendError(RuntimeError):
    """Base infrastructure failure for the selected runtime backend."""


class HomeSnapshotCreateError(RuntimeBackendError):
    pass


class HomeSnapshotNotFoundError(RuntimeBackendError):
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


class WorkspacePathError(RuntimeBackendError):
    pass


class WorkspaceFileTooLargeError(RuntimeBackendError):
    path: str
    size: int
    max_bytes: int

    def __init__(self, *, path: str, size: int, max_bytes: int) -> None:
        self.path = path
        self.size = size
        self.max_bytes = max_bytes
        super().__init__(f"Workspace file {path!r} exceeds the {max_bytes}-byte ToolFile upload limit")


__all__ = [
    "BindingAcquireError",
    "BindingCreateError",
    "BindingDestroyError",
    "BindingLostError",
    "HomeSnapshotCreateError",
    "HomeSnapshotNotFoundError",
    "RuntimeBackendError",
    "SharedWorkspaceUnsupportedError",
    "WorkspaceFileTooLargeError",
    "WorkspacePathError",
    "WorkspacePreservationUnsupportedError",
    "WorkspaceUnavailableError",
]
