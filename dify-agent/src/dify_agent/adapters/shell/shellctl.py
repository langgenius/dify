from __future__ import annotations

import base64
import binascii
import logging
import re
import time
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, TypeVar

from dify_agent.adapters.shell.protocols import (
    ShellCommandProtocol,
    ShellCommandResult,
    ShellCommandStatus,
    ShellFileTransferProtocol,
    ShellProviderError,
    ShellProviderProtocol,
    ShellResourceProtocol,
)

logger = logging.getLogger(__name__)

ResultT = TypeVar("ResultT")

_DEFAULT_TIMEOUT_SECONDS = 30.0
_READ_OUTPUT_TIMEOUT_SECONDS = 0.0
_DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_FILE_TRANSFER_TIMEOUT_SECONDS = 60.0
_SHELLCTL_OUTPUT_LIMIT_BYTES = 16 * 1024
_TRANSFER_BEGIN = "<<<DIFY_SHELL_FILE_BEGIN>>>"
_TRANSFER_END = "<<<DIFY_SHELL_FILE_END>>>"
_DOWNLOAD_MISSING_EXIT_CODE = 66


class ShellFileTransferError(RuntimeError):
    """Raised when a file cannot be uploaded or downloaded through shellctl."""


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
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
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

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        return _from_job_result(await _run_client_call(self.client.run(script, cwd=cwd, env=env, timeout=timeout)))

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
        return _from_job_result(
            await _run_client_call(self.client.input(job_id, text, offset=offset, timeout=timeout))
        )

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
            _ = await self.client.delete(job_id, force=force, grace_seconds=grace_seconds)
        except RuntimeError as exc:
            if getattr(exc, "code", None) == "job_not_found":
                return
            raise _map_error(exc) from exc


@dataclass(slots=True)
class ShellctlFileTransfer(ShellFileTransferProtocol):
    client: ShellctlClientProtocol
    timeout: float = _FILE_TRANSFER_TIMEOUT_SECONDS

    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None:
        encoded = base64.b64encode(content).decode("ascii")
        completed = await _run_to_completion(
            self.client,
            _upload_script(remote_path=remote_path, encoded=encoded),
            cwd=cwd,
            timeout=self.timeout,
        )
        if completed.exit_code != 0:
            raise ShellFileTransferError(
                f"Failed to upload to {remote_path!r}: exit_code={completed.exit_code}, "
                f"output={_output_tail(completed.output)!r}"
            )

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes:
        completed = await _run_to_completion(
            self.client,
            _download_script(remote_path=remote_path),
            cwd=cwd,
            timeout=self.timeout,
        )
        if completed.exit_code == _DOWNLOAD_MISSING_EXIT_CODE:
            raise ShellFileTransferError(f"Remote path not found: {remote_path!r}.")
        if completed.exit_code != 0:
            raise ShellFileTransferError(
                f"Failed to download {remote_path!r}: exit_code={completed.exit_code}, "
                f"output={_output_tail(completed.output)!r}"
            )
        encoded = _extract_transfer_payload(completed.output)
        try:
            return base64.b64decode(encoded.encode("ascii"), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ShellFileTransferError(f"Downloaded payload for {remote_path!r} was not valid base64.") from exc


@dataclass(slots=True)
class ShellctlResource(ShellResourceProtocol):
    client: ShellctlClientProtocol
    commands: ShellCommandProtocol
    files: ShellFileTransferProtocol

    async def close(self) -> None:
        try:
            await self.client.close()
        except RuntimeError as exc:
            raise _map_error(exc) from exc


@dataclass(slots=True)
class ShellctlProvider(ShellProviderProtocol):
    entrypoint: str
    token: str
    output_limit: int = _SHELLCTL_OUTPUT_LIMIT_BYTES
    client_factory: ShellctlClientFactory | None = None

    async def create(self) -> ShellctlResource:
        client = (
            self.client_factory()
            if self.client_factory is not None
            else create_default_shellctl_client_factory(
                entrypoint=self.entrypoint,
                token=self.token,
                output_limit=self.output_limit,
            )()
        )
        return ShellctlResource(
            client=client,
            commands=ShellctlCommands(client=client),
            files=ShellctlFileTransfer(client=client),
        )


def create_default_shellctl_client_factory(
    *,
    entrypoint: str,
    token: str,
    output_limit: int = _SHELLCTL_OUTPUT_LIMIT_BYTES,
) -> ShellctlClientFactory:
    def factory() -> ShellctlClientProtocol:
        from shell_session_manager.shellctl.client import ShellctlClient

        return ShellctlClient(entrypoint, token=token, output_limit=output_limit)

    return factory


@dataclass(frozen=True, slots=True)
class _CompletedShellctlJob:
    job_id: str
    exit_code: int | None
    output: str


async def _run_client_call(awaitable: Awaitable[ResultT]) -> ResultT:
    try:
        return await awaitable
    except RuntimeError as exc:
        raise _map_error(exc) from exc


def _map_error(exc: RuntimeError) -> ShellProviderError:
    return ShellProviderError(str(exc), code=getattr(exc, "code", None))


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


async def _run_to_completion(
    client: ShellctlClientProtocol,
    script: str,
    *,
    cwd: str | None,
    timeout: float,
) -> _CompletedShellctlJob:
    deadline = time.monotonic() + timeout
    job_id: str | None = None
    try:
        result = await _run_client_call(
            client.run(script, cwd=cwd, env=None, timeout=_remaining_timeout(deadline))
        )
        parts = [result.output]
        job_id = result.job_id
        while not result.done or result.truncated:
            result = await _run_client_call(
                client.wait(job_id, offset=result.offset, timeout=_remaining_timeout(deadline))
            )
            parts.append(result.output)
        return _CompletedShellctlJob(job_id=job_id, exit_code=result.exit_code, output="".join(parts))
    finally:
        if job_id is not None:
            try:
                await client.delete(job_id, force=True)
            except RuntimeError as exc:
                logger.warning("Failed to delete shellctl job %s: %s", job_id, exc)


def _upload_script(*, remote_path: str, encoded: str) -> str:
    return (
        "set -eu\n"
        f"mkdir -p \"$(dirname -- {_shquote(remote_path)})\"\n"
        f"printf %s {_shquote(encoded)} | base64 -d > {_shquote(remote_path)}"
    )


def _download_script(*, remote_path: str) -> str:
    return "\n".join(
        [
            "set -eu",
            f"path={_shquote(remote_path)}",
            'if [ ! -f "$path" ]; then exit 66; fi',
            f"printf %s {_shquote(_TRANSFER_BEGIN)}",
            'base64 < "$path" | tr -d "\\n"',
            f"printf %s {_shquote(_TRANSFER_END)}",
        ]
    )


def _extract_transfer_payload(output: str) -> str:
    pattern = re.escape(_TRANSFER_BEGIN) + r"(.*?)" + re.escape(_TRANSFER_END)
    match = re.search(pattern, output, re.DOTALL)
    if match is None:
        raise ShellFileTransferError("Transfer payload markers were missing from shell output.")
    return "".join(match.group(1).split())


def _output_tail(output: str, *, limit: int = 256) -> str:
    return output[-limit:]


def _remaining_timeout(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0.0:
        raise ShellProviderError("Shellctl command timed out before completion.", code="timeout")
    return remaining


def _shquote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


__all__ = [
    "ShellFileTransferError",
    "ShellctlClientFactory",
    "ShellctlClientProtocol",
    "ShellctlCommands",
    "ShellctlFileTransfer",
    "ShellctlProvider",
    "ShellctlResource",
    "create_default_shellctl_client_factory",
]
