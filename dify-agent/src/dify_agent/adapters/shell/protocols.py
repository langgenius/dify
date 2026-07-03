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

    async def close(self) -> None: ...


class ShellProviderProtocol(Protocol):
    async def create(self) -> ShellResourceProtocol: ...
