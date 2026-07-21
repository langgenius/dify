"""Shellctl command and file data-plane adapters for runtime Sandbox leases.

The built-in shellctl SDK owns the HTTP timeout policy for long-polling
shellctl requests. This adapter translates SDK and transport failures into
``ShellProviderError`` and securely binds Workspace paths with
descriptor-relative, no-follow traversal. Whole-file reads return bytes to the
control plane; they never create another sandbox-visible upload path.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import shlex
import time
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, TypeVar, cast

import httpx2 as httpx

from dify_agent.adapters.shell.protocols import (
    ShellCommandProtocol,
    ShellCommandResult,
    ShellCommandStatus,
    ShellFileTransferProtocol,
    ShellProviderError,
)
from dify_agent.runtime_backend.errors import (
    WorkspaceFileTooLargeError,
    WorkspacePathError,
    WorkspaceUnavailableError,
)
from dify_agent.runtime_backend.protocols import (
    WorkspaceFileEntry,
    WorkspaceFileContent,
    WorkspaceListResult,
    WorkspaceReadResult,
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
_WORKSPACE_PAYLOAD_BEGIN = "<<<DIFY_WORKSPACE_BEGIN>>>"
_WORKSPACE_PAYLOAD_END = "<<<DIFY_WORKSPACE_END>>>"

_LIST_WORKSPACE_SCRIPT = r"""
import base64
import errno
import json
import os
import stat
import sys

root = sys.argv[1]
relative = sys.argv[2]
limit = int(sys.argv[3])
# DIFY_WORKSPACE_CHECKPOINT: arguments_loaded
path_parts = [] if relative == "." else relative.split("/")
if any(part in {"", ".", ".."} for part in path_parts):
    raise PermissionError("workspace path must contain only concrete relative components")

directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
open_fds = []
try:
    current_fd = os.open(root, directory_flags)
    open_fds.append(current_fd)
    for part in path_parts:
        current_fd = os.open(part, directory_flags, dir_fd=current_fd)
        open_fds.append(current_fd)
    target_fd = current_fd
    # DIFY_WORKSPACE_CHECKPOINT: directory_opened
    names = sorted(os.listdir(target_fd))
    entries = []
    for name in names[:limit]:
        child_stat = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        mode = child_stat.st_mode
        entry_type = (
            "symlink" if stat.S_ISLNK(mode) else
            "dir" if stat.S_ISDIR(mode) else
            "file" if stat.S_ISREG(mode) else
            "other"
        )
        entries.append({
            "name": name,
            "type": entry_type,
            "size": int(child_stat.st_size),
            "mtime": int(child_stat.st_mtime),
        })
except OSError as exc:
    if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
        raise PermissionError("workspace path traverses a symlink") from exc
    raise
finally:
    for opened_fd in reversed(open_fds):
        os.close(opened_fd)

payload = {"path": relative, "entries": entries, "truncated": len(names) > limit}
blob = base64.b64encode(json.dumps(payload).encode()).decode()
print("<<<DIFY_WORKSPACE_BEGIN>>>" + blob + "<<<DIFY_WORKSPACE_END>>>")
"""

_READ_WORKSPACE_SCRIPT = r"""
import base64
import errno
import json
import os
import stat
import sys

root = sys.argv[1]
relative = sys.argv[2]
max_bytes = int(sys.argv[3])
# DIFY_WORKSPACE_CHECKPOINT: arguments_loaded
path_parts = relative.split("/")
if not path_parts or any(part in {"", ".", ".."} for part in path_parts):
    raise PermissionError("workspace path must contain only concrete relative components")

directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
open_fds = []
try:
    current_fd = os.open(root, directory_flags)
    open_fds.append(current_fd)
    for part in path_parts[:-1]:
        current_fd = os.open(part, directory_flags, dir_fd=current_fd)
        open_fds.append(current_fd)
    file_fd = os.open(path_parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
    open_fds.append(file_fd)
    # DIFY_WORKSPACE_CHECKPOINT: file_opened
    file_stat = os.fstat(file_fd)
    if not stat.S_ISREG(file_stat.st_mode):
        raise FileNotFoundError(relative)
    size = int(file_stat.st_size)
    data = os.read(file_fd, max_bytes + 1)
except OSError as exc:
    if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
        raise PermissionError("workspace path traverses a symlink") from exc
    raise
finally:
    for opened_fd in reversed(open_fds):
        os.close(opened_fd)

truncated = len(data) > max_bytes
data = data[:max_bytes]
try:
    text = data.decode("utf-8")
    binary = False
except UnicodeDecodeError:
    text = None
    binary = True
payload = {
    "path": relative,
    "size": size,
    "truncated": truncated,
    "binary": binary,
    "text": text,
}
blob = base64.b64encode(json.dumps(payload).encode()).decode()
print("<<<DIFY_WORKSPACE_BEGIN>>>" + blob + "<<<DIFY_WORKSPACE_END>>>")
"""

_READ_WORKSPACE_BYTES_SCRIPT = r"""
import base64
import errno
import json
import os
import stat
import sys

root = sys.argv[1]
relative = sys.argv[2]
max_bytes = int(sys.argv[3])
# DIFY_WORKSPACE_CHECKPOINT: arguments_loaded
path_parts = relative.split("/")
if not path_parts or any(part in {"", ".", ".."} for part in path_parts):
    raise PermissionError("workspace path must contain only concrete relative components")

directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
open_fds = []
try:
    current_fd = os.open(root, directory_flags)
    open_fds.append(current_fd)
    for part in path_parts[:-1]:
        current_fd = os.open(part, directory_flags, dir_fd=current_fd)
        open_fds.append(current_fd)
    file_fd = os.open(path_parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
    open_fds.append(file_fd)
    # DIFY_WORKSPACE_CHECKPOINT: file_opened
    file_stat = os.fstat(file_fd)
    if not stat.S_ISREG(file_stat.st_mode):
        raise FileNotFoundError(relative)
    size = int(file_stat.st_size)
    # DIFY_WORKSPACE_CHECKPOINT: file_size_captured
    content = None
    if size <= max_bytes:
        chunks = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(file_fd, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        captured = b"".join(chunks)
        if len(captured) > max_bytes:
            size = max(size, len(captured))
        else:
            content = captured
except OSError as exc:
    if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
        raise PermissionError("workspace path traverses a symlink") from exc
    raise
finally:
    for opened_fd in reversed(open_fds):
        os.close(opened_fd)

if content is None:
    payload = {"path": relative, "size": size, "too_large": True}
else:
    payload = {
        "path": relative,
        "size": size,
        "content_base64": base64.b64encode(content).decode("ascii"),
    }
blob = base64.b64encode(json.dumps(payload).encode()).decode()
print("<<<DIFY_WORKSPACE_BEGIN>>>" + blob + "<<<DIFY_WORKSPACE_END>>>")
"""


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


@dataclass(slots=True)
class ShellctlFileTransfer(ShellFileTransferProtocol):
    client: ShellctlClientProtocol
    timeout: float = _FILE_TRANSFER_TIMEOUT_SECONDS

    async def list_directory(
        self,
        *,
        workspace_dir: str,
        path: str,
        limit: int,
    ) -> WorkspaceListResult:
        payload = await self._run_workspace_script(
            _LIST_WORKSPACE_SCRIPT,
            args=[workspace_dir, path, str(limit)],
        )
        raw_entries = payload.get("entries")
        if not isinstance(raw_entries, list):
            raise WorkspaceUnavailableError("workspace list returned an invalid entries payload")
        entries: list[WorkspaceFileEntry] = []
        for raw_entry in raw_entries:
            if not isinstance(raw_entry, dict):
                raise WorkspaceUnavailableError("workspace list returned an invalid entry")
            entries.append(
                WorkspaceFileEntry(
                    name=str(raw_entry.get("name", "")),
                    type=str(raw_entry.get("type", "other")),
                    size=int(raw_entry["size"]) if isinstance(raw_entry.get("size"), int) else None,
                    mtime=int(raw_entry["mtime"]) if isinstance(raw_entry.get("mtime"), int) else None,
                )
            )
        return WorkspaceListResult(
            path=str(payload.get("path", path)),
            entries=tuple(entries),
            truncated=payload.get("truncated") is True,
        )

    async def read_file(
        self,
        *,
        workspace_dir: str,
        path: str,
        max_bytes: int,
    ) -> WorkspaceReadResult:
        payload = await self._run_workspace_script(
            _READ_WORKSPACE_SCRIPT,
            args=[workspace_dir, path, str(max_bytes)],
        )
        size = payload.get("size")
        if not isinstance(size, int):
            raise WorkspaceUnavailableError("workspace read returned an invalid size")
        text = payload.get("text")
        return WorkspaceReadResult(
            path=str(payload.get("path", path)),
            size=size,
            truncated=payload.get("truncated") is True,
            binary=payload.get("binary") is True,
            text=text if isinstance(text, str) else None,
        )

    async def read_bytes(
        self,
        *,
        workspace_dir: str,
        path: str,
        max_bytes: int,
    ) -> WorkspaceFileContent:
        if max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        payload = await self._run_workspace_script(
            _READ_WORKSPACE_BYTES_SCRIPT,
            args=[workspace_dir, path, str(max_bytes)],
        )
        size = payload.get("size")
        if payload.get("too_large") is True:
            if not isinstance(size, int):
                raise WorkspaceUnavailableError("workspace bytes read returned an invalid size")
            raise WorkspaceFileTooLargeError(path=str(payload.get("path", path)), size=size, max_bytes=max_bytes)
        encoded = payload.get("content_base64")
        if not isinstance(size, int) or not isinstance(encoded, str):
            raise WorkspaceUnavailableError("workspace bytes read returned an invalid payload")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise WorkspaceUnavailableError("workspace bytes read returned invalid base64") from exc
        if len(content) != size:
            raise WorkspaceUnavailableError("workspace bytes read returned an invalid size")
        return WorkspaceFileContent(
            path=str(payload.get("path", path)),
            size=size,
            content=content,
        )

    async def _run_workspace_script(self, source: str, *, args: list[str]) -> dict[str, object]:
        command = _python_stdin_command(source, args=args)
        completed = await _run_to_completion(self.client, command, cwd=None, timeout=self.timeout)
        if completed.exit_code != 0:
            detail = _output_tail(completed.output)
            if "PermissionError" in completed.output:
                raise WorkspacePathError(detail)
            raise WorkspaceUnavailableError(detail)
        return _decode_workspace_payload(completed.output)

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


@dataclass(frozen=True, slots=True)
class _CompletedShellctlJob:
    job_id: str
    exit_code: int | None
    output: str


async def _run_client_call(awaitable: Awaitable[ResultT]) -> ResultT:
    """Map shellctl client boundary failures into provider-layer errors."""

    try:
        return await awaitable
    except httpx.TimeoutException as exc:
        raise ShellProviderError(str(exc), code="timeout") from exc
    except httpx.RequestError as exc:
        raise ShellProviderError(str(exc), code="request_error") from exc
    except RuntimeError as exc:
        raise _map_error(exc) from exc


def _map_error(exc: RuntimeError) -> ShellProviderError:
    code = getattr(exc, "code", None)
    status_code = getattr(exc, "status_code", None)
    return ShellProviderError(
        str(exc),
        code=code if isinstance(code, str) else None,
        status_code=status_code if isinstance(status_code, int) else None,
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
        result = await _run_client_call(client.run(script, cwd=cwd, env=None, timeout=_remaining_timeout(deadline)))
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
                await _run_client_call(client.delete(job_id, force=True))
            except RuntimeError as exc:
                logger.warning("Failed to delete shellctl job %s: %s", job_id, exc)


def _upload_script(*, remote_path: str, encoded: str) -> str:
    return (
        "set -eu\n"
        f'mkdir -p "$(dirname -- {_shquote(remote_path)})"\n'
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


def _python_stdin_command(source: str, *, args: list[str]) -> str:
    quoted_args = " ".join(shlex.quote(value) for value in args)
    return f"python3 - {quoted_args} <<'PY'\n{source.strip()}\nPY"


def _decode_workspace_payload(output: str) -> dict[str, object]:
    begin = output.find(_WORKSPACE_PAYLOAD_BEGIN)
    end = output.find(_WORKSPACE_PAYLOAD_END, begin + len(_WORKSPACE_PAYLOAD_BEGIN)) if begin >= 0 else -1
    if begin < 0 or end < 0:
        raise WorkspaceUnavailableError("workspace command returned no framed payload")
    encoded = "".join(output[begin + len(_WORKSPACE_PAYLOAD_BEGIN) : end].split())
    try:
        value = json.loads(base64.b64decode(encoded, validate=True).decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise WorkspaceUnavailableError("workspace command returned an invalid framed payload") from exc
    if not isinstance(value, dict):
        raise WorkspaceUnavailableError("workspace command returned a non-object payload")
    return cast(dict[str, object], value)


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
    "create_default_shellctl_client_factory",
]
