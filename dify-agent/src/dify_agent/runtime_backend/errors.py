"""Stable runtime-backend failures exposed above provider-specific adapters."""


class RuntimeBackendError(RuntimeError):
    """Base class for infrastructure failures raised by runtime backend drivers."""


class HomeSnapshotCreateError(RuntimeBackendError):
    """Raised when an immutable Home Snapshot cannot be created."""


class HomeSnapshotNotFoundError(RuntimeBackendError):
    """Raised when a referenced Home Snapshot no longer exists."""


class SandboxCreateError(RuntimeBackendError):
    """Raised when a physical sandbox cannot be provisioned."""


class SandboxResumeError(RuntimeBackendError):
    """Raised when a sandbox cannot be resumed for a transient reason."""


class SandboxLostError(RuntimeBackendError):
    """Raised when a retained sandbox was confirmed absent or expired."""


class SandboxBackendUnavailableError(RuntimeBackendError):
    """Raised when the selected runtime backend cannot be reached."""


class SandboxCleanupError(RuntimeBackendError):
    """Raised when a sandbox cannot be suspended or deleted."""


class WorkspaceUnavailableError(RuntimeBackendError):
    """Raised when the workspace retained inside a sandbox is unavailable."""


class WorkspacePathError(RuntimeBackendError):
    """Raised when a requested workspace-relative path escapes its root."""


class WorkspaceFileTooLargeError(RuntimeBackendError):
    """Raised before reading a Workspace file that exceeds a caller's byte limit."""

    path: str
    size: int
    max_bytes: int

    def __init__(self, *, path: str, size: int, max_bytes: int) -> None:
        self.path = path
        self.size = size
        self.max_bytes = max_bytes
        super().__init__(f"Workspace file {path!r} exceeds the {max_bytes}-byte ToolFile upload limit")


__all__ = [
    "HomeSnapshotCreateError",
    "HomeSnapshotNotFoundError",
    "RuntimeBackendError",
    "SandboxBackendUnavailableError",
    "SandboxCleanupError",
    "SandboxCreateError",
    "SandboxLostError",
    "SandboxResumeError",
    "WorkspaceFileTooLargeError",
    "WorkspacePathError",
    "WorkspaceUnavailableError",
]
