"""Binding filesystem operations through an operation-scoped RuntimeLease."""

from __future__ import annotations

import base64
import json
import logging
import posixpath
import re
import shlex
from dataclasses import dataclass
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult, ShellProviderError
from dify_agent.agent_stub.protocol import is_canonical_dify_file_reference
from dify_agent.agent_stub.shell_env import ShellAgentStubTokenFactory, build_shell_agent_stub_env
from dify_agent.protocol import (
    BindingFileDownloadRequest,
    BindingFileDownloadResponse,
    BindingFileListRequest,
    BindingFileListResponse,
    BindingFileReadRequest,
    BindingFileReadResponse,
)
from dify_agent.runtime.command_runner import execute_complete_with_commands
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingLostError,
    ExecutionBindingBackend,
    RuntimeLayout,
    WorkspaceUnavailableError,
)
from dify_agent.runtime_backend.leases import open_runtime_lease

logger = logging.getLogger(__name__)

_LIST_MAX_ENTRIES = 1000
_BROWSE_TIMEOUT_SECONDS = 60.0
_BROWSE_OUTPUT_MAX_BYTES = 1024 * 1024
_DOWNLOAD_OUTPUT_MAX_BYTES = 32 * 1024
_PAYLOAD_BEGIN = "<<<DIFY_BINDING_FILE_BEGIN>>>"
_PAYLOAD_END = "<<<DIFY_BINDING_FILE_END>>>"

_LIST_BINDING_FILES_SCRIPT = r"""
import base64
import json
import os
import stat
import sys

path = sys.argv[1]
response_path = sys.argv[2]
limit = int(sys.argv[3])
directory_fd = None
try:
    directory_fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    names = sorted(os.listdir(directory_fd))
    entries = []
    for name in names[:limit]:
        child_stat = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
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
finally:
    if directory_fd is not None:
        os.close(directory_fd)

payload = {"path": response_path, "entries": entries, "truncated": len(names) > limit}
blob = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
print("<<<DIFY_BINDING_FILE_BEGIN>>>" + blob + "<<<DIFY_BINDING_FILE_END>>>")
"""

_READ_BINDING_FILE_SCRIPT = r"""
import base64
import json
import os
import stat
import sys

path = sys.argv[1]
response_path = sys.argv[2]
max_bytes = int(sys.argv[3])
file_fd = None
try:
    file_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    file_stat = os.fstat(file_fd)
    if not stat.S_ISREG(file_stat.st_mode):
        raise FileNotFoundError(path)
    size = int(file_stat.st_size)
    data = os.read(file_fd, max_bytes + 1)
finally:
    if file_fd is not None:
        os.close(file_fd)

truncated = len(data) > max_bytes
data = data[:max_bytes]
try:
    text = data.decode("utf-8")
    binary = False
except UnicodeDecodeError:
    text = None
    binary = True
payload = {
    "path": response_path,
    "size": size,
    "truncated": truncated,
    "binary": binary,
    "text": text,
}
blob = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
print("<<<DIFY_BINDING_FILE_BEGIN>>>" + blob + "<<<DIFY_BINDING_FILE_END>>>")
"""


class BindingFileError(Exception):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class _CliUploadResult(BaseModel):
    transfer_method: Literal["tool_file"]
    reference: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")


@dataclass(slots=True)
class BindingFileService:
    execution_bindings: ExecutionBindingBackend
    agent_stub_api_base_url: str | None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None
    download_command_timeout_seconds: float

    async def list_files(self, request: BindingFileListRequest) -> BindingFileListResponse:
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                resolved_path = resolve_binding_path(request.path, lease.layout)
                result = await execute_complete_with_commands(
                    lease.commands,
                    _python_command(
                        _LIST_BINDING_FILES_SCRIPT,
                        resolved_path,
                        request.path,
                        str(_LIST_MAX_ENTRIES),
                    ),
                    cwd=lease.layout.workspace_dir,
                    env={"HOME": lease.layout.home_dir},
                    timeout=_BROWSE_TIMEOUT_SECONDS,
                    max_output_bytes=_BROWSE_OUTPUT_MAX_BYTES,
                    mode="stdio",
                )
            payload = _require_browse_payload(result, operation="list")
            try:
                return BindingFileListResponse.model_validate(payload)
            except ValidationError as exc:
                raise WorkspaceUnavailableError("Binding file list returned an invalid response") from exc
        except BindingFileError:
            raise
        except Exception as exc:
            raise _normalize_binding_file_error(exc) from exc

    async def read_file(self, request: BindingFileReadRequest) -> BindingFileReadResponse:
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                resolved_path = resolve_binding_path(request.path, lease.layout)
                result = await execute_complete_with_commands(
                    lease.commands,
                    _python_command(
                        _READ_BINDING_FILE_SCRIPT,
                        resolved_path,
                        request.path,
                        str(request.max_bytes),
                    ),
                    cwd=lease.layout.workspace_dir,
                    env={"HOME": lease.layout.home_dir},
                    timeout=_BROWSE_TIMEOUT_SECONDS,
                    max_output_bytes=_BROWSE_OUTPUT_MAX_BYTES,
                    mode="stdio",
                )
            payload = _require_browse_payload(result, operation="read")
            try:
                return BindingFileReadResponse.model_validate(payload)
            except ValidationError as exc:
                raise WorkspaceUnavailableError("Binding file read returned an invalid response") from exc
        except BindingFileError:
            raise
        except Exception as exc:
            raise _normalize_binding_file_error(exc) from exc

    async def download_file(self, request: BindingFileDownloadRequest) -> BindingFileDownloadResponse:
        context = request.execution_context
        if not context.user_id or not context.user_from:
            raise BindingFileError(
                "invalid_execution_context",
                "Binding file download requires user_id and user_from",
                status_code=400,
            )
        if self.agent_stub_api_base_url is None or self.agent_stub_token_factory is None:
            raise BindingFileError(
                "agent_stub_upload_unavailable",
                "Agent Stub file upload is not configured",
                status_code=503,
            )

        try:
            agent_stub_env = build_shell_agent_stub_env(
                agent_stub_api_base_url=self.agent_stub_api_base_url,
                execution_context=context,
                token_factory=self.agent_stub_token_factory,
                session_id=None,
            )
            if agent_stub_env is None:
                raise BindingFileError(
                    "agent_stub_upload_unavailable",
                    "Agent Stub file upload is not configured",
                    status_code=503,
                )
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                resolved_path = resolve_binding_path(request.path, lease.layout)
                env = {"HOME": lease.layout.home_dir, **agent_stub_env}
                try:
                    result = await execute_complete_with_commands(
                        lease.commands,
                        f"dify-agent file upload --no-download-link {shlex.quote(resolved_path)}",
                        cwd=lease.layout.workspace_dir,
                        env=env,
                        timeout=self.download_command_timeout_seconds,
                        max_output_bytes=_DOWNLOAD_OUTPUT_MAX_BYTES,
                        mode="stdio",
                    )
                except ShellProviderError as exc:
                    if exc.code == "timeout":
                        raise _download_failed() from exc
                    raise
            if result.exit_code != 0 or not result.output_complete:
                _log_download_failure(result.output, agent_stub_env)
                raise _download_failed()
            try:
                payload = json.loads(result.output)
                uploaded = _CliUploadResult.model_validate(payload)
            except (json.JSONDecodeError, ValidationError, TypeError) as exc:
                raise _download_failed() from exc
            if not is_canonical_dify_file_reference(uploaded.reference):
                raise _download_failed()
            return BindingFileDownloadResponse(reference=uploaded.reference)
        except BindingFileError:
            raise
        except Exception as exc:
            normalized = _normalize_binding_file_error(exc)
            if normalized.code in {"binding_not_found", "binding_unavailable"}:
                raise normalized from exc
            raise _download_failed() from exc


def resolve_binding_path(path: str, layout: RuntimeLayout) -> str:
    """Resolve convenient Binding paths without adding a containment policy."""

    if path == "~":
        candidate = layout.home_dir
    elif path.startswith("~/"):
        candidate = posixpath.join(layout.home_dir, path[2:])
    elif posixpath.isabs(path):
        candidate = path
    else:
        candidate = posixpath.join(layout.workspace_dir, path or ".")
    return posixpath.normpath(candidate)


def _python_command(source: str, *args: str) -> str:
    return " ".join(["python3", "-c", shlex.quote(source), *(shlex.quote(arg) for arg in args)])


def _require_browse_payload(result: CompleteShellCommandResult, *, operation: str) -> dict[str, object]:
    exit_code = result.exit_code
    output_complete = result.output_complete
    output = result.output
    if exit_code != 0:
        if any(
            name in output
            for name in ("FileNotFoundError", "NotADirectoryError", "IsADirectoryError", "PermissionError")
        ):
            raise BindingFileError(
                "invalid_binding_path",
                f"Binding file {operation} path is unavailable",
                status_code=400,
            )
        raise WorkspaceUnavailableError(f"Binding file {operation} command failed")
    if not output_complete:
        raise WorkspaceUnavailableError(f"Binding file {operation} output was incomplete")
    match = re.search(re.escape(_PAYLOAD_BEGIN) + r"(.*?)" + re.escape(_PAYLOAD_END), output, flags=re.DOTALL)
    if match is None:
        raise WorkspaceUnavailableError(f"Binding file {operation} returned no framed payload")
    try:
        decoded = base64.b64decode("".join(match.group(1).split()), validate=True)
        payload = json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as exc:
        raise WorkspaceUnavailableError(f"Binding file {operation} returned an invalid payload") from exc
    if not isinstance(payload, dict):
        raise WorkspaceUnavailableError(f"Binding file {operation} returned a non-object payload")
    return payload


def _normalize_binding_file_error(exc: Exception) -> BindingFileError:
    if isinstance(exc, BindingFileError):
        return exc
    if isinstance(exc, ValueError):
        return BindingFileError("invalid_binding_path", "Binding file path or payload is invalid", status_code=400)
    if isinstance(exc, BindingLostError):
        return BindingFileError("binding_not_found", "Execution Binding was not found", status_code=404)
    if isinstance(exc, BindingAcquireError | WorkspaceUnavailableError):
        return BindingFileError("binding_unavailable", "Execution Binding is unavailable", status_code=502)
    return BindingFileError("binding_unavailable", "Execution Binding file operation failed", status_code=502)


def _download_failed() -> BindingFileError:
    return BindingFileError(
        "binding_file_download_failed",
        "Binding file could not be converted to a ToolFile",
        status_code=502,
    )


def _log_download_failure(output: str, env: dict[str, str]) -> None:
    redacted = output
    for secret in env.values():
        if len(secret) > 8:
            redacted = redacted.replace(secret, "***")
    logger.warning("Binding file upload command failed: %s", redacted[-1024:])


__all__ = ["BindingFileError", "BindingFileService", "resolve_binding_path"]
