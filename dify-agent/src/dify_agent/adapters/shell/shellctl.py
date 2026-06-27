from __future__ import annotations

import base64
import binascii
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from dify_agent.adapters.shell.protocols import ShellEnvironmentDescriptor, ShellHandle

logger = logging.getLogger(__name__)

_WORKSPACE_ROOT = "~/workspace"
_DEFAULT_TIMEOUT_SECONDS = 30.0
# Drains at most this many shellctl output windows per wait so a stuck or
# pathologically chatty job cannot loop forever inside one wait() call.
_MAX_OUTPUT_WINDOWS = 64
_DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_FILE_TRANSFER_TIMEOUT_SECONDS = 60.0
# Sentinels frame base64 download payloads so prompt/tmux noise around the
# shellctl merged output stream can be stripped before decoding.
_TRANSFER_BEGIN = "<<<DIFY_SHELL_FILE_BEGIN>>>"
_TRANSFER_END = "<<<DIFY_SHELL_FILE_END>>>"
_DOWNLOAD_MISSING_EXIT_CODE = 66


class ShellProvisionError(RuntimeError):
    """Raised when a shell environment cannot be provisioned."""


class ShellFileTransferError(RuntimeError):
    """Raised when a file cannot be uploaded to or downloaded from the workspace."""


class ShellctlJobResult(Protocol):
    """Structural shape of one shellctl job result the adapter relies on.

    Mirrors the fields the adapter reads from ``shell_session_manager`` job
    results without importing the concrete type, so the merged output stream,
    paging offset, completion flag, and exit status stay duck-typed.
    """

    job_id: str
    done: bool
    output: str
    offset: int
    truncated: bool
    exit_code: int | None


class ShellctlJobStatus(Protocol):
    """Structural shape of one shellctl status-only result (no output stream).

    Returned by ``terminate``; carries completion and exit status plus the
    latest paging offset so the adapter can drain any remaining output.
    """

    job_id: str
    done: bool
    offset: int
    exit_code: int | None


class ShellctlClientProtocol(Protocol):
    """Boundary the shellctl adapter needs from a shell-session-manager client."""

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

    async def terminate(
        self,
        job_id: str,
        grace_seconds: float = _DEFAULT_TERMINATE_GRACE_SECONDS,
    ) -> ShellctlJobStatus: ...

    async def delete(self, job_id: str, *, force: bool = False) -> object: ...

    async def close(self) -> None: ...


type ShellctlClientFactory = Callable[[], ShellctlClientProtocol]


class ShellctlExecutionResult:
    """Completed shellctl command result.

    shellctl merges stderr into a single output stream, so ``stderr()`` is
    always empty and the merged stream is reported as ``stdout()``.
    """

    _stdout: str
    _stderr: str
    _exit_code: int | None
    _truncated: bool

    def __init__(
        self,
        *,
        stdout: str,
        stderr: str = "",
        exit_code: int | None,
        truncated: bool = False,
    ) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self._exit_code = exit_code
        self._truncated = truncated

    def stdout(self) -> str:
        return self._stdout

    def stderr(self) -> str:
        return self._stderr

    def exit_code(self) -> int | None:
        return self._exit_code

    def truncated(self) -> bool:
        """Whether the returned ``stdout`` may be incomplete.

        ``True`` means shellctl still reported more output past what was
        captured when draining stopped (its per-window ``truncated`` flag on the
        final window, e.g. the output-window cap was hit). Callers that need the
        command's *entire* output must treat a truncated result as a failure or
        re-read, rather than trusting ``stdout()`` as complete.
        """
        return self._truncated


@dataclass(slots=True)
class ShellctlExecutor:
    """Runs commands in one provisioned shellctl workspace.

    Conforms structurally to ``ShellExecutorProtocol``. ``execute`` drains the
    command to completion (accumulating shellctl's paged output windows) and
    best-effort deletes the finished job before returning. The executor is
    single-environment and is not safe to share across workspaces.
    """

    client: ShellctlClientProtocol
    workspace_cwd: str
    timeout: float = _DEFAULT_TIMEOUT_SECONDS

    async def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> ShellctlExecutionResult:
        result = await self.client.run(
            command,
            cwd=cwd if cwd is not None else self.workspace_cwd,
            env=env,
            timeout=self.timeout,
        )
        output_parts = [result.output]
        done = result.done
        truncated = result.truncated
        offset = result.offset
        exit_code = result.exit_code
        job_id = result.job_id
        windows = 1
        while (not done or truncated) and windows < _MAX_OUTPUT_WINDOWS:
            result = await self.client.wait(job_id, offset=offset, timeout=self.timeout)
            output_parts.append(result.output)
            done = result.done
            truncated = result.truncated
            offset = result.offset
            exit_code = result.exit_code
            windows += 1
        if done:
            await _delete_job_best_effort(self.client, job_id)
        return ShellctlExecutionResult(
            stdout="".join(output_parts),
            exit_code=exit_code,
            truncated=truncated,
        )


@dataclass(slots=True)
class ShellctlFileTransfer:
    """Moves file bytes in and out of one provisioned shellctl workspace.

    Conforms structurally to ``ShellFileTransferProtocol``. Transfers run as
    workspace-scoped shellctl jobs over the merged text channel: uploads embed
    base64 in the command and pipe it through ``base64 -d``; downloads emit the
    file's base64 framed by sentinels so prompt/tmux noise can be stripped
    before decoding. Because the encoded payload is embedded in the upload
    command, very large files can exceed the shell argument limit; this
    primitive targets ordinary control-plane file sizes, not bulk binary
    transfer.
    """

    client: ShellctlClientProtocol
    workspace_cwd: str
    timeout: float = _FILE_TRANSFER_TIMEOUT_SECONDS

    async def upload(self, *, content: bytes, remote_path: str) -> None:
        encoded = base64.b64encode(content).decode("ascii")
        completed = await _run_to_completion(
            self.client,
            _upload_script(remote_path=remote_path, encoded=encoded),
            cwd=self.workspace_cwd,
            timeout=self.timeout,
        )
        if completed.exit_code != 0:
            raise ShellFileTransferError(
                f"Failed to upload to {remote_path!r}: exit_code={completed.exit_code}, "
                f"output={_output_tail(completed.output)!r}"
            )

    async def download(self, *, remote_path: str) -> bytes:
        completed = await _run_to_completion(
            self.client,
            _download_script(remote_path=remote_path),
            cwd=self.workspace_cwd,
            timeout=self.timeout,
        )
        if completed.exit_code == _DOWNLOAD_MISSING_EXIT_CODE:
            raise ShellFileTransferError(f"File not found in workspace: {remote_path!r}.")
        if completed.exit_code != 0:
            raise ShellFileTransferError(
                f"Failed to download {remote_path!r}: exit_code={completed.exit_code}, "
                f"output={_output_tail(completed.output)!r}"
            )
        framed = _extract_framed_payload(completed.output)
        try:
            return base64.b64decode("".join(framed.split()), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ShellFileTransferError(f"Failed to decode downloaded file {remote_path!r}: {exc}") from exc


@dataclass(slots=True)
class ShellctlHandle:
    """Live reference to one provisioned shellctl workspace.

    Conforms structurally to ``ShellHandle``. Owns the shellctl ``client`` and
    the allocated ``workspace_cwd`` until the provisioner destroys it.
    ``get_executor`` returns a fresh executor bound to this workspace each call.
    """

    client: ShellctlClientProtocol
    workspace_cwd: str
    session_id: str

    def descriptor(self) -> ShellEnvironmentDescriptor:
        return ShellEnvironmentDescriptor(workspace_cwd=self.workspace_cwd, session_id=self.session_id)

    async def get_executor(self) -> ShellctlExecutor:
        return ShellctlExecutor(client=self.client, workspace_cwd=self.workspace_cwd)

    async def get_file_transfer(self) -> ShellctlFileTransfer:
        return ShellctlFileTransfer(client=self.client, workspace_cwd=self.workspace_cwd)


@dataclass(slots=True)
class ShellctlProvisioner:
    """Provisions isolated shellctl workspaces, one client per environment.

    Conforms structurally to ``ShellProvisionProtocol``.
    """

    client_factory: ShellctlClientFactory
    timeout: float = _DEFAULT_TIMEOUT_SECONDS

    async def provision(self) -> ShellctlHandle:
        client = self.client_factory()
        session_id = _generate_session_id()
        workspace_cwd = f"{_WORKSPACE_ROOT}/{session_id}"
        try:
            completed = await _run_to_completion(client, _mkdir_script(session_id), cwd=None, timeout=self.timeout)
        except BaseException:
            await client.close()
            raise
        if completed.exit_code != 0:
            await client.close()
            raise ShellProvisionError(
                f"Failed to create shell workspace {workspace_cwd}: mkdir exited with code {completed.exit_code}."
            )
        return ShellctlHandle(client=client, workspace_cwd=workspace_cwd, session_id=session_id)

    async def reattach(self, descriptor: ShellEnvironmentDescriptor) -> ShellctlHandle:
        """Rebuild a live handle for an existing workspace without re-allocating it.

        Opens a fresh shellctl client and points it at the workspace recorded in
        ``descriptor``. No ``mkdir`` is issued: the workspace is assumed to still
        exist from the original ``provision``. Used on snapshot resume so a run
        can keep executing in and eventually clean up its prior workspace.
        """
        client = self.client_factory()
        return ShellctlHandle(
            client=client,
            workspace_cwd=descriptor.workspace_cwd,
            session_id=descriptor.session_id,
        )

    async def destroy(self, handle: ShellHandle) -> None:
        if not isinstance(handle, ShellctlHandle):
            raise TypeError("ShellctlProvisioner can only destroy handles it provisioned.")
        try:
            completed = await _run_to_completion(
                handle.client, _cleanup_script(handle.session_id), cwd=None, timeout=self.timeout
            )
            if completed.exit_code != 0:
                logger.warning(
                    "Shell workspace cleanup for session %s exited with code %s.",
                    handle.session_id,
                    completed.exit_code,
                )
        except (RuntimeError, ValueError) as exc:
            logger.warning("Failed to remove shell workspace for session %s: %s", handle.session_id, exc)
        finally:
            await handle.client.close()


def create_default_shellctl_client_factory(*, entrypoint: str, token: str) -> ShellctlClientFactory:
    """Return a factory that builds a real shell-session-manager shellctl client.

    The concrete client is imported lazily so importing this module does not
    require the private ``shell-session-manager`` package. An explicit empty
    ``token`` is forwarded as-is to avoid the client falling back to ambient
    process credentials.
    """

    def factory() -> ShellctlClientProtocol:
        from shell_session_manager.shellctl.client import ShellctlClient

        return ShellctlClient(entrypoint, token=token)

    return factory


@dataclass(slots=True)
class _CompletedJob:
    """Drained result of one internal shellctl job: merged output plus exit code."""

    output: str
    exit_code: int | None


async def _run_to_completion(
    client: ShellctlClientProtocol,
    script: str,
    *,
    cwd: str | None,
    timeout: float,
) -> _CompletedJob:
    """Run one internal lifecycle script to completion, returning output and exit code."""
    result = await client.run(script, cwd=cwd, env=None, timeout=timeout)
    output_parts = [result.output]
    done = result.done
    truncated = result.truncated
    offset = result.offset
    exit_code = result.exit_code
    job_id = result.job_id
    windows = 1
    while (not done or truncated) and windows < _MAX_OUTPUT_WINDOWS:
        result = await client.wait(job_id, offset=offset, timeout=timeout)
        output_parts.append(result.output)
        done = result.done
        truncated = result.truncated
        offset = result.offset
        exit_code = result.exit_code
        windows += 1
    if done:
        await _delete_job_best_effort(client, job_id)
    return _CompletedJob(output="".join(output_parts), exit_code=exit_code)


async def _delete_job_best_effort(client: ShellctlClientProtocol, job_id: str) -> None:
    """Force-delete one shellctl job, never failing the caller on cleanup errors."""
    try:
        _ = await client.delete(job_id, force=True)
    except Exception as exc:  # noqa: BLE001 - best-effort teardown must not surface cleanup errors
        logger.warning("Failed to delete shellctl job %s: %s", job_id, exc)


def _generate_session_id() -> str:
    """Return a shell-safe random session id used as the workspace directory name."""
    return secrets.token_hex(8)


def _mkdir_script(session_id: str) -> str:
    return f'mkdir -p "$HOME/workspace/{session_id}"'


def _cleanup_script(session_id: str) -> str:
    return f'rm -rf -- "$HOME/workspace/{session_id}"'


def _upload_script(*, remote_path: str, encoded: str) -> str:
    """Return a script that recreates a file from embedded base64 in the workspace."""
    quoted = _shquote(remote_path)
    return f"mkdir -p \"$(dirname -- {quoted})\" && printf %s '{encoded}' | base64 -d > {quoted}"


def _download_script(*, remote_path: str) -> str:
    """Return a script that emits a file's base64 between transfer sentinels."""
    quoted = _shquote(remote_path)
    return (
        f"if [ ! -f {quoted} ]; then exit {_DOWNLOAD_MISSING_EXIT_CODE}; fi; "
        f"printf %s {_shquote(_TRANSFER_BEGIN)}; "
        f'base64 < {quoted} | tr -d "\\n"; '
        f"printf %s {_shquote(_TRANSFER_END)}"
    )


def _extract_framed_payload(output: str) -> str:
    """Return the base64 text framed by the transfer sentinels in shellctl output."""
    begin = output.find(_TRANSFER_BEGIN)
    end = output.find(_TRANSFER_END, begin + len(_TRANSFER_BEGIN)) if begin != -1 else -1
    if begin == -1 or end == -1:
        raise ShellFileTransferError("download command returned no framed payload")
    return output[begin + len(_TRANSFER_BEGIN) : end]


def _shquote(value: str) -> str:
    """Single-quote a value for POSIX shells, escaping embedded single quotes."""
    return "'" + value.replace("'", "'\\''") + "'"


def _output_tail(output: str, *, limit: int = 500) -> str:
    """Return the trailing slice of command output for compact error messages."""
    return output[-limit:]


__all__ = [
    "ShellFileTransferError",
    "ShellProvisionError",
    "ShellctlClientFactory",
    "ShellctlClientProtocol",
    "ShellctlExecutionResult",
    "ShellctlExecutor",
    "ShellctlFileTransfer",
    "ShellctlHandle",
    "ShellctlJobResult",
    "ShellctlJobStatus",
    "ShellctlProvisioner",
    "create_default_shellctl_client_factory",
]
