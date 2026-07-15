from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class ShellCommandResult:
    job_id: str
    status: str
    done: bool
    exit_code: int | None
    output: str
    offset: int
    truncated: bool
    output_path: str | None = None


@dataclass(frozen=True, slots=True)
class ShellCommandStatus:
    job_id: str
    status: str
    done: bool
    exit_code: int | None
    offset: int


@dataclass(frozen=True, slots=True)
class CompleteShellCommandResult:
    job_id: str
    status: str
    done: bool
    exit_code: int | None
    output: str
    output_complete: bool
    incomplete_reason: Literal["output_limit", "timeout"] | None
    offset: int
    output_path: str | None = None


@dataclass(frozen=True, slots=True)
class ShellPromptObservation:
    text: str
    output_path: str | None
    offset: int


class ShellProviderError(RuntimeError):
    code: str | None

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


class SandboxExpiredError(ShellProviderError):
    """Raised by a shell provider when ``attach()`` targets a sandbox that no longer exists."""

    def __init__(self, sandbox_id: str, *, cause: ShellProviderError) -> None:
        super().__init__(str(cause), code=cause.code)
        self.sandbox_id = sandbox_id
        self.__cause__ = cause


class ShellCommandProtocol(Protocol):
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult: ...

    async def wait(
        self,
        job_id: str,
        *,
        offset: int,
        timeout: float,
    ) -> ShellCommandResult: ...

    async def read_output(
        self,
        job_id: str,
        *,
        offset: int,
    ) -> ShellCommandResult: ...

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float,
    ) -> ShellCommandResult: ...

    async def interrupt(
        self,
        job_id: str,
        *,
        grace_seconds: float,
    ) -> ShellCommandStatus: ...

    async def tail(self, job_id: str) -> ShellCommandResult: ...

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None: ...


class ShellFileTransferProtocol(Protocol):
    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None: ...

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes: ...


class ShellResourceProtocol(Protocol):
    @property
    def commands(self) -> ShellCommandProtocol: ...

    @property
    def files(self) -> ShellFileTransferProtocol: ...

    @property
    def sandbox_id(self) -> str | None: ...

    async def suspend(self) -> None:
        """Detach from the sandbox without destroying it.

        Called when the resource scope exits with suspend intent. The sandbox
        remains alive and can be re-attached later via ``attach(sandbox_id)``.
        """
        ...

    async def delete(self) -> None:
        """Destroy the sandbox and release all resources.

        Called when the resource scope exits with delete intent. The sandbox is
        permanently removed and cannot be re-attached.
        """
        ...


class ShellProviderProtocol(Protocol):
    async def create(self) -> ShellResourceProtocol:
        """Provision a new sandbox and return a live resource."""
        ...

    async def attach(self, sandbox_id: str) -> ShellResourceProtocol:
        """Connect to an existing sandbox without provisioning a new one.

        The returned resource carries the same ``sandbox_id`` so the caller can
        persist it across runs and re-attach as needed.
        """
        ...
