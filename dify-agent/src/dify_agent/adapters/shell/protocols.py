"""Provider-agnostic shell provisioning and execution boundary.

The contract is two-phase so different shell backends can plug in behind one
interface:

1. A ``ShellProvisionProtocol`` (the *Provisioner*) sets up one shell
   environment via ``provision()`` and tears it down via ``destroy()``.
2. The returned ``ShellHandle`` hands out a ``ShellExecutorProtocol`` (the
   *Executor*), which starts commands and waits for their results.

``ShellExecutionResult`` exposes ``stdout``, ``stderr``, and ``exit_code`` as
the reserved, provider-agnostic result surface. A backend that cannot populate
one of them leaves it blank (empty string for stdout/stderr, ``None`` for
exit_code); for example the default shellctl backend merges stderr into stdout
and always reports an empty ``stderr()``.

The default implementation and env-var-driven provider selection live in
``dify_agent.adapters.shell.shellctl`` and ``dify_agent.adapters.shell.factory``.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class ShellExecutionHandle:
    """Opaque reference to one started shell command.

    ``job_id`` is backend-defined and is only meaningful to the executor that
    produced it. Callers must treat it as opaque and pass it back unchanged.
    """

    job_id: str


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

    Only ``execute`` and ``wait`` are required. Interactive stdin and
    interruption are optional capabilities advertised by the separate
    ``SupportsShellInput`` and ``SupportsShellInterrupt`` protocols; callers must
    feature-detect them (e.g. ``isinstance(executor, SupportsShellInput)``)
    before use, since not every backend supports them.
    """

    async def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> ShellExecutionHandle: ...

    async def wait(self, handle: ShellExecutionHandle) -> ShellExecutionResult: ...


@runtime_checkable
class SupportsShellInput(Protocol):
    """Optional capability: send stdin to a running command, then await its result.

    Only backends that can write to a live process's stdin implement this.
    ``input`` waits for the command to finish after sending ``text`` (the base
    contract has no partial-output form), so it suits answering a single prompt,
    not multi-turn interaction.
    """

    async def input(self, handle: ShellExecutionHandle, text: str) -> ShellExecutionResult: ...


@runtime_checkable
class SupportsShellInterrupt(Protocol):
    """Optional capability: interrupt a running command and await its result.

    Only backends that can signal/terminate a live process implement this.
    """

    async def interrupt(self, handle: ShellExecutionHandle) -> ShellExecutionResult: ...


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