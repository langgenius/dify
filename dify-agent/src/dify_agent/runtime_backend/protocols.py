"""Backend-neutral runtime resource contracts.

Drivers own physical Home Snapshot and sandbox lifecycle. A ``SandboxLease``
contains only invocation-local clients and canonical paths; it must never be
serialized into an Agenton session snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from dify_agent.adapters.shell.protocols import ShellCommandProtocol


@dataclass(frozen=True, slots=True)
class HomeSnapshotFile:
    """One home-relative file materialized while building an immutable snapshot."""

    path: str
    content: bytes


@dataclass(frozen=True, slots=True)
class HomeSnapshotSource:
    """Canonical Home content supplied by Dify API for one config version."""

    files: tuple[HomeSnapshotFile, ...] = ()


@dataclass(frozen=True, slots=True)
class CreateHomeSnapshotRequest:
    """Canonical config-version source used to create one immutable Home resource."""

    tenant_id: str
    agent_id: str
    agent_config_version_id: str
    source_digest: str
    source: HomeSnapshotSource


class HomeSnapshotDriver(Protocol):
    """Manage backend-native immutable Home resources without storing their refs.

    Dify API owns the config-version-to-ref mapping. Implementations may perform
    remote I/O, but credentials and clients stay inside the selected backend.
    """

    async def create(self, request: CreateHomeSnapshotRequest) -> str:
        """Materialize Home and return its stable, non-sensitive native ref.

        The source is immutable for its config version. Implementations release
        temporary clients or builders best-effort on cancellation or failure,
        but the public contract does not guarantee orphan rollback; manual
        backend cleanup may be required. Backend failures raise
        ``HomeSnapshotCreateError``.
        """
        ...

    async def delete(self, snapshot_ref: str) -> None:
        """Delete one Home resource, treating an already-absent ref as success.

        This operation is driven by config lifecycle, never runtime-session
        cleanup. Backend cleanup failures use a runtime-backend domain error.
        """
        ...


@dataclass(frozen=True, slots=True)
class SandboxCreateSpec:
    """Stable Dify identities and immutable Home input for Sandbox creation."""

    tenant_id: str
    agent_id: str
    agent_config_version_id: str
    runtime_session_id: str
    home_snapshot_ref: str


@dataclass(frozen=True, slots=True)
class SandboxLayout:
    """Canonical Home and Workspace roots exposed by one active lease."""

    home_dir: str
    workspace_dir: str


@dataclass(frozen=True, slots=True)
class WorkspaceFileEntry:
    name: str
    type: str
    size: int | None
    mtime: int | None


@dataclass(frozen=True, slots=True)
class WorkspaceListResult:
    path: str
    entries: tuple[WorkspaceFileEntry, ...]
    truncated: bool


@dataclass(frozen=True, slots=True)
class WorkspaceReadResult:
    path: str
    size: int
    truncated: bool
    binary: bool
    text: str | None


@dataclass(frozen=True, slots=True)
class WorkspaceFileContent:
    """Immutable in-process copy of one securely opened Workspace file."""

    path: str
    size: int
    content: bytes


class FileSystem(Protocol):
    """File operations scoped by an explicit canonical workspace root.

    ``read_bytes`` must bind the source with descriptor-relative, no-follow
    traversal and finish reading before returning. Control-plane callers can
    then upload the returned bytes without exposing another sandbox pathname.
    """

    async def list_directory(
        self,
        *,
        workspace_dir: str,
        path: str,
        limit: int,
    ) -> WorkspaceListResult:
        """List at most ``limit`` entries below the canonical Workspace root.

        ``path`` is Workspace-relative and all components must remain beneath
        ``workspace_dir`` without following symlinks. The result reports
        truncation when more entries exist. Invalid containment raises
        ``WorkspacePathError``; backend or payload failure raises
        ``WorkspaceUnavailableError``.
        """
        ...

    async def read_file(
        self,
        *,
        workspace_dir: str,
        path: str,
        max_bytes: int,
    ) -> WorkspaceReadResult:
        """Read a bounded text preview from one Workspace-relative file.

        The no-follow containment rules from ``list_directory`` apply. At most
        ``max_bytes`` are decoded, ``truncated`` reports a larger file, and a
        binary result has ``binary=True`` with no text. Invalid paths raise
        ``WorkspacePathError``; read failures raise
        ``WorkspaceUnavailableError``.
        """
        ...

    async def read_bytes(
        self,
        *,
        workspace_dir: str,
        path: str,
        max_bytes: int,
    ) -> WorkspaceFileContent:
        """Capture one complete, securely opened Workspace file in memory.

        ``path`` is Workspace-relative and no symlink is followed. Files larger
        than ``max_bytes`` raise ``WorkspaceFileTooLargeError`` instead of
        returning partial bytes. Invalid containment raises
        ``WorkspacePathError``; backend or payload failure raises
        ``WorkspaceUnavailableError``.
        """
        ...

    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None:
        """Perform an internal raw transfer to a caller-selected Sandbox path.

        Unlike the Workspace-scoped methods, this primitive does not establish
        root containment. Drivers may use it only with paths they construct;
        product file APIs must not pass user paths to it.
        """
        ...

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes:
        """Perform an internal raw transfer from a caller-selected Sandbox path.

        This primitive is not a Workspace browse contract and does not promise
        ``WorkspacePathError`` or byte-limit behavior. Product file APIs use
        ``read_file`` or ``read_bytes`` instead.
        """
        ...


class SandboxLease(Protocol):
    """Invocation-local access to one stable Sandbox and its data plane.

    Leases may own clients, transports, and temporary access tokens. They must
    never be serialized into an Agenton session snapshot.
    """

    @property
    def handle(self) -> str: ...

    @property
    def layout(self) -> SandboxLayout: ...

    @property
    def commands(self) -> ShellCommandProtocol: ...

    @property
    def files(self) -> FileSystem: ...


class SandboxDriver(Protocol):
    """Own physical Sandbox lifecycle for one deployment-selected backend."""

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        """Create one retained Sandbox and return its first live lease.

        The returned handle is stable for the runtime session. Creation also
        materializes the immutable Home input and prepares the current
        Workspace. Cancellation and failure trigger best-effort rollback;
        ordinary backend failures raise ``SandboxCreateError``.
        """
        ...

    async def resume(self, handle: str) -> SandboxLease:
        """Reconnect to exactly ``handle`` without creating replacement state.

        The lease must preserve the handle and latest Workspace. Confirmed loss
        raises ``SandboxLostError``; transient reconnect failures raise
        ``SandboxResumeError``.
        """
        ...

    async def suspend(self, lease: SandboxLease) -> None:
        """Release a live lease while retaining its Sandbox and Workspace.

        Backends may additionally pause the physical resource. Implementations
        raise ``SandboxCleanupError`` if data-plane release or pause fails.
        """
        ...

    async def delete(self, handle: str) -> None:
        """Delete a retained Sandbox and Workspace idempotently by stable handle.

        An already-absent resource is success. Other cleanup failures raise
        ``SandboxCleanupError``; immutable Home resources are outside this call.
        """
        ...


@dataclass(frozen=True, slots=True)
class RuntimeBackendProfile:
    """Coherent Home and Sandbox drivers selected once by server deployment."""

    backend_id: str
    home_snapshots: HomeSnapshotDriver
    sandboxes: SandboxDriver


__all__ = [
    "CreateHomeSnapshotRequest",
    "FileSystem",
    "HomeSnapshotDriver",
    "HomeSnapshotFile",
    "HomeSnapshotSource",
    "RuntimeBackendProfile",
    "SandboxCreateSpec",
    "SandboxDriver",
    "SandboxLayout",
    "SandboxLease",
    "WorkspaceFileEntry",
    "WorkspaceFileContent",
    "WorkspaceListResult",
    "WorkspaceReadResult",
]
