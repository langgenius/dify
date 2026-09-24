"""Shellctl command adapter for RuntimeLease objects.

The built-in shellctl SDK owns the HTTP timeout policy for long-polling
shellctl requests. This adapter translates SDK and transport failures into
``ShellProviderError``.
"""

from __future__ import annotations

import posixpath
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol, TypeVar, cast

import httpx2 as httpx
from shellctl.client import ShellctlClientError
from shellctl.shared import HealthResponse, JobMode

from dify_agent.adapters.shell.protocols import (
    ShellCommandProtocol,
    ShellCommandResult,
    ShellCommandStatus,
    ShellExecutionMode,
    ShellProviderError,
)

ResultT = TypeVar("ResultT")

_DEFAULT_TIMEOUT_SECONDS = 30.0
_READ_OUTPUT_TIMEOUT_SECONDS = 0.0
_DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_SHELLCTL_OUTPUT_LIMIT_BYTES = 16 * 1024


class ShellctlJobResult(Protocol):
    job_id: str
    status: object
    done: bool
    output: str
    offset: int
    truncated: bool
    exit_code: int | None
    output_path: str | None


class ShellctlJobStatus(Protocol):
    job_id: str
    status: object
    done: bool
    offset: int
    exit_code: int | None


class ShellctlClientProtocol(Protocol):
    async def health(self) -> HealthResponse: ...

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        mode: JobMode = JobMode.PTY,
    ) -> ShellctlJobResult: ...

    async def wait(
        self,
        job_id: str,
        *,
        offset: int,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> ShellctlJobResult: ...

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> ShellctlJobResult: ...

    async def tail(self, job_id: str) -> ShellctlJobResult: ...

    async def terminate(
        self,
        job_id: str,
        grace_seconds: float = _DEFAULT_TERMINATE_GRACE_SECONDS,
    ) -> ShellctlJobStatus: ...

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> object: ...

    async def close(self) -> None: ...


type ShellctlClientFactory = Callable[[], ShellctlClientProtocol]


@dataclass(slots=True)
class ShellctlCommands(ShellCommandProtocol):
    client: ShellctlClientProtocol
    home_dir: str | None = None
    workspace_dir: str | None = None

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        resolved_cwd = _resolve_lease_cwd(
            cwd,
            home_dir=self.home_dir,
            workspace_dir=self.workspace_dir,
        )
        resolved_env = _lease_env(env, home_dir=self.home_dir)
        return _from_job_result(
            await _run_client_call(
                self.client.run(
                    script,
                    cwd=resolved_cwd,
                    env=resolved_env,
                    timeout=timeout,
                    mode=JobMode(mode),
                )
            )
        )

    async def wait(
        self,
        job_id: str,
        *,
        offset: int,
        timeout: float,
    ) -> ShellCommandResult:
        return _from_job_result(await _run_client_call(self.client.wait(job_id, offset=offset, timeout=timeout)))

    async def read_output(
        self,
        job_id: str,
        *,
        offset: int,
    ) -> ShellCommandResult:
        return _from_job_result(
            await _run_client_call(self.client.wait(job_id, offset=offset, timeout=_READ_OUTPUT_TIMEOUT_SECONDS))
        )

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float,
    ) -> ShellCommandResult:
        return _from_job_result(await _run_client_call(self.client.input(job_id, text, offset=offset, timeout=timeout)))

    async def interrupt(
        self,
        job_id: str,
        *,
        grace_seconds: float,
    ) -> ShellCommandStatus:
        return _from_job_status(await _run_client_call(self.client.terminate(job_id, grace_seconds=grace_seconds)))

    async def tail(self, job_id: str) -> ShellCommandResult:
        return _from_job_result(await _run_client_call(self.client.tail(job_id)))

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None:
        try:
            _ = await _run_client_call(self.client.delete(job_id, force=force, grace_seconds=grace_seconds))
        except ShellProviderError as exc:
            if exc.code == "job_not_found":
                return
            raise


def create_default_shellctl_client_factory(
    *,
    entrypoint: str,
    token: str,
    output_limit: int = _SHELLCTL_OUTPUT_LIMIT_BYTES,
) -> ShellctlClientFactory:
    def factory() -> ShellctlClientProtocol:
        from shellctl.client import ShellctlClient

        return cast(
            ShellctlClientProtocol,
            cast(
                object,
                ShellctlClient(entrypoint, token=token, output_limit=output_limit),
            ),
        )

    return factory


async def _run_client_call(awaitable: Awaitable[ResultT]) -> ResultT:
    """Map shellctl client boundary failures into provider-layer errors."""

    try:
        return await awaitable
    except httpx.TimeoutException as exc:
        raise ShellProviderError(str(exc), code="timeout") from exc
    except httpx.RequestError as exc:
        raise ShellProviderError(str(exc), code="request_error") from exc
    except ShellctlClientError as exc:
        raise _map_error(exc) from exc


def _map_error(exc: ShellctlClientError) -> ShellProviderError:
    return ShellProviderError(
        str(exc),
        code=exc.code,
        status_code=exc.status_code,
    )


def _from_job_result(result: ShellctlJobResult) -> ShellCommandResult:
    return ShellCommandResult(
        job_id=result.job_id,
        status=_status_name(result.status),
        done=result.done,
        exit_code=result.exit_code,
        output=result.output,
        offset=result.offset,
        truncated=result.truncated,
        output_path=result.output_path or None,
    )


def _from_job_status(result: ShellctlJobStatus) -> ShellCommandStatus:
    return ShellCommandStatus(
        job_id=result.job_id,
        status=_status_name(result.status),
        done=result.done,
        exit_code=result.exit_code,
        offset=result.offset,
    )


def _status_name(status: object) -> str:
    value = getattr(status, "value", None)
    if isinstance(value, str):
        return value
    if isinstance(status, str):
        return status
    return str(status)


def _lease_env(env: dict[str, str] | None, *, home_dir: str | None) -> dict[str, str] | None:
    if home_dir is None:
        return env
    resolved = dict(env or {})
    resolved["HOME"] = home_dir
    return resolved


def _resolve_lease_cwd(
    cwd: str | None,
    *,
    home_dir: str | None,
    workspace_dir: str | None,
) -> str | None:
    if home_dir is None or workspace_dir is None:
        return cwd
    if cwd is None or cwd == "":
        candidate = workspace_dir
    elif cwd == "~":
        candidate = home_dir
    elif cwd.startswith("~/"):
        candidate = posixpath.join(home_dir, cwd[2:])
    elif posixpath.isabs(cwd):
        candidate = cwd
    else:
        candidate = posixpath.join(workspace_dir, cwd)
    candidate = posixpath.normpath(candidate)
    roots = (posixpath.normpath(home_dir), posixpath.normpath(workspace_dir))
    if not any(posixpath.commonpath((candidate, root)) == root for root in roots):
        raise ValueError("shell cwd is outside this RuntimeLease Home and Workspace")
    return candidate


__all__ = [
    "ShellctlClientFactory",
    "ShellctlClientProtocol",
    "ShellctlCommands",
    "create_default_shellctl_client_factory",
]
