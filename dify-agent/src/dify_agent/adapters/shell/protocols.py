from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ShellEnvironmentDescriptor:
    """Minimal, serializable seed used to re-derive a provisioned environment.

    Holds only the provider-agnostic identity needed to reattach to an existing
    shell environment across a snapshot/resume cycle — never live resources
    (clients, handles, executors). Callers persist this in their snapshot and
    pass it back to ``ShellProvisionProtocol.reattach`` to reconstruct an
    equivalent ``ShellHandle`` without allocating a new environment. The shellctl
    backend stores the isolated workspace path (and its session id) here.
    """

    workspace_cwd: str
    session_id: str


class ShellExecutionResult(Protocol):
    """Completed shell command result.

    ``stdout``/``stderr``/``exit_code`` are reserved fields. Backends that
    cannot distinguish a stream return an empty string for it, and return
    ``None`` from ``exit_code()`` when no exit status is available.
    """

    def stdout(self) -> str: ...

    def stderr(self) -> str: ...

    def exit_code(self) -> int | None: ...

    def truncated(self) -> bool: ...


class ShellExecutorProtocol(Protocol):
    """Runs commands inside an already-provisioned shell environment.

    ``execute`` drains the command to completion before returning — there is no
    separate ``wait`` step. This suits the current server-side callers (sandbox
    file helpers, workspace bootstrap) that always run a script to completion.

    If a future use case needs to start a command, interact with its stdin, or
    interrupt it before completion, split this protocol into ``execute`` →
    ``ShellExecutionHandle`` plus ``wait`` / ``input`` / ``interrupt`` optional
    capabilities, mirroring the shape that was prototyped here before
    simplification.
    """

    async def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> ShellExecutionResult: ...


class ShellFileTransferProtocol(Protocol):
    """Moves file bytes between the caller and a provisioned shell environment.

    ``remote_path`` is interpreted by the backend relative to the provisioned
    environment (for the shellctl backend, the session workspace). Higher-level
    Dify/skill transfers are layered on top of this primitive, not implemented
    here. Implementations raise on transfer failure (missing path, decode error,
    or a non-zero transfer command).
    """

    async def upload(self, *, content: bytes, remote_path: str) -> None: ...

    async def download(self, *, remote_path: str) -> bytes: ...


class ShellHandle(Protocol):
    """Live reference to one provisioned shell environment.

    The handle itself is not serialized. ``descriptor()`` returns the minimal
    seed needed to reconstruct an equivalent handle after a snapshot/resume.
    """

    def descriptor(self) -> ShellEnvironmentDescriptor: ...

    async def get_executor(self) -> ShellExecutorProtocol: ...

    async def get_file_transfer(self) -> ShellFileTransferProtocol: ...


class ShellProvisionProtocol(Protocol):
    """Creates, reattaches to, and destroys shell environments.

    ``provision`` allocates a fresh environment; ``reattach`` rebuilds a live
    handle for an environment that already exists (from a persisted descriptor)
    without allocating a new one, so resumed runs can keep executing and
    eventually clean up. ``destroy`` tears an environment down.
    """

    async def provision(self) -> ShellHandle: ...

    async def reattach(self, descriptor: ShellEnvironmentDescriptor) -> ShellHandle: ...

    async def destroy(self, handle: ShellHandle) -> None: ...
