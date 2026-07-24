"""Backend-neutral contracts for persistent working environments.

Dify API owns logical Home Snapshot, Workspace, and Agent Workspace Binding
records. Backends own their physical representations. ``RuntimeLease`` is the
only invocation-local object and must never be serialized or persisted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from dify_agent.adapters.shell.protocols import ShellCommandProtocol


@dataclass(frozen=True, slots=True)
class InitializeHomeSnapshotSpec:
    tenant_id: str
    agent_id: str
    home_snapshot_id: str


@dataclass(frozen=True, slots=True)
class HomeSnapshotCreateSpec:
    tenant_id: str
    agent_id: str
    home_snapshot_id: str


@dataclass(frozen=True, slots=True)
class RuntimeLayout:
    """Canonical Home and Workspace roots exposed for one operation."""

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
    path: str
    size: int
    content: bytes


class FileSystem(Protocol):
    """File operations interpreted in the current RuntimeLease namespace."""

    async def list_directory(self, *, path: str, limit: int) -> WorkspaceListResult: ...

    async def read_file(self, *, path: str, max_bytes: int) -> WorkspaceReadResult: ...

    async def read_bytes(self, *, path: str, max_bytes: int) -> WorkspaceFileContent: ...

    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None: ...

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes: ...


class RuntimeLease(Protocol):
    """Invocation-local data-plane access to one persistent Binding."""

    @property
    def layout(self) -> RuntimeLayout: ...

    @property
    def commands(self) -> ShellCommandProtocol: ...

    @property
    def files(self) -> FileSystem: ...


@dataclass(frozen=True, slots=True)
class ExecutionBindingCreateSpec:
    tenant_id: str
    agent_id: str
    binding_id: str
    workspace_id: str
    existing_workspace_ref: str | None
    home_snapshot_ref: str


@dataclass(frozen=True, slots=True)
class ExecutionBindingAllocation:
    binding_ref: str
    workspace_ref: str


@dataclass(frozen=True, slots=True)
class ExecutionBindingDestroySpec:
    binding_ref: str
    destroy_workspace: bool
    workspace_ref: str | None = None

    def __post_init__(self) -> None:
        if self.destroy_workspace and not self.workspace_ref:
            raise ValueError("workspace_ref is required when destroy_workspace is true")


class ExecutionBindingBackend(Protocol):
    """Manage physical Binding, Materialized Home, and Workspace resources."""

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation: ...

    async def acquire(self, binding_ref: str) -> RuntimeLease: ...

    async def release(self, lease: RuntimeLease) -> None: ...

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None: ...


class HomeSnapshotBackend(Protocol):
    """Manage immutable backend-native Home resources."""

    async def initialize(self, spec: InitializeHomeSnapshotSpec) -> str: ...

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str: ...

    async def delete(self, snapshot_ref: str) -> None: ...


@dataclass(frozen=True, slots=True)
class RuntimeBackendProfile:
    """Coherent Home and Binding backends selected once per deployment."""

    home_snapshots: HomeSnapshotBackend
    execution_bindings: ExecutionBindingBackend


__all__ = [
    "ExecutionBindingAllocation",
    "ExecutionBindingBackend",
    "ExecutionBindingCreateSpec",
    "ExecutionBindingDestroySpec",
    "FileSystem",
    "HomeSnapshotBackend",
    "HomeSnapshotCreateSpec",
    "InitializeHomeSnapshotSpec",
    "RuntimeBackendProfile",
    "RuntimeLayout",
    "RuntimeLease",
    "WorkspaceFileContent",
    "WorkspaceFileEntry",
    "WorkspaceListResult",
    "WorkspaceReadResult",
]
