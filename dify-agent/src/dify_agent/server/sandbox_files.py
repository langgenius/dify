"""Sandbox file service that re-enters prior shell sessions through the shell layer.

Unlike the removed workspace inspector, this service never talks to shellctl
directly and never reads sandbox files outside the shell layer. It rebuilds a
minimal compositor from ``SandboxLocator``, enters the saved
``execution_context`` + ``shell`` layers, and executes fixed scripts through
``DifyShellLayer.run_remote_script_complete()``.

The scripts still frame their structured payloads with a PTY-safe
base64-between-sentinels envelope. shellctl jobs are tmux-backed, so raw JSON can
be wrapped or surrounded by prompt noise; the framing keeps list/read/upload
responses parseable without falling back to direct shellctl file access. Path
arguments stay relative to the saved shell workspace cwd, but the scripts do not
re-impose a workspace-root boundary, so callers can use ``../`` when the
sandbox filesystem layout expects it.
"""

from __future__ import annotations

import json
import base64
import binascii
import shlex
import textwrap
from dataclasses import dataclass
from typing import TypeVar, cast

from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer
from dify_agent.layers.shell.output_text import utf8_suffix
from dify_agent.protocol import (
    SandboxListRequest,
    SandboxListResponse,
    SandboxLocator,
    SandboxReadRequest,
    SandboxReadResponse,
    SandboxUploadRequest,
    SandboxUploadResponse,
    normalize_composition,
)
from pydantic import BaseModel, ValidationError
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider, build_pydantic_ai_compositor

_LIST_MAX_ENTRIES = 1000
_LIST_TIMEOUT_SECONDS = 10.0
_READ_TIMEOUT_SECONDS = 15.0
_UPLOAD_TIMEOUT_SECONDS = 30.0
_OUTPUT_BEGIN = "<<<DIFY_SANDBOX_BEGIN>>>"
_OUTPUT_END = "<<<DIFY_SANDBOX_END>>>"
_SHELL_RESULT_OUTPUT_TAIL_BYTES = 8 * 1024
ResponseModelT = TypeVar("ResponseModelT", bound=BaseModel)

_LIST_SCRIPT = """
import base64
import json
import stat
import sys
from pathlib import Path


BEGIN = "<<<DIFY_SANDBOX_BEGIN>>>"
END = "<<<DIFY_SANDBOX_END>>>"


def emit(payload):
    blob = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    print(BEGIN + blob + END)


raw_path = sys.argv[1]
limit = int(sys.argv[2])
target = Path(raw_path).resolve()

if not target.exists():
    emit({"error": "sandbox_path_not_found", "message": "path not found in sandbox"})
    sys.exit(0)
if not target.is_dir():
    emit({"error": "sandbox_path_not_readable", "message": "path is not a directory"})
    sys.exit(0)

entries = []
for child in sorted(target.iterdir(), key=lambda item: item.name)[:limit]:
    child_stat = child.lstat()
    mode = child_stat.st_mode
    if stat.S_ISLNK(mode):
        entry_type = "symlink"
    elif stat.S_ISDIR(mode):
        entry_type = "dir"
    elif stat.S_ISREG(mode):
        entry_type = "file"
    else:
        entry_type = "other"
    entries.append(
        {
            "name": child.name,
            "type": entry_type,
            "size": int(child_stat.st_size),
            "mtime": int(child_stat.st_mtime),
        }
    )

emit(
    {
        "path": raw_path,
        "entries": entries,
        "truncated": len(list(target.iterdir())) > limit,
    }
)
"""

_READ_SCRIPT = """
import base64
import json
import sys
from pathlib import Path


BEGIN = "<<<DIFY_SANDBOX_BEGIN>>>"
END = "<<<DIFY_SANDBOX_END>>>"


def emit(payload):
    blob = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    print(BEGIN + blob + END)


raw_path = sys.argv[1]
max_bytes = int(sys.argv[2])
target = Path(raw_path).resolve()
if not target.exists():
    emit({"error": "sandbox_path_not_found", "message": "path not found in sandbox"})
    sys.exit(0)
if not target.is_file():
    emit({"error": "sandbox_path_not_readable", "message": "path is not a readable file"})
    sys.exit(0)

size = int(target.stat().st_size)
with target.open("rb") as file_obj:
    data = file_obj.read(max_bytes + 1)

truncated = len(data) > max_bytes
data = data[:max_bytes]
try:
    text = data.decode("utf-8")
except UnicodeDecodeError:
    emit(
        {
            "path": raw_path,
            "size": size,
            "truncated": truncated,
            "binary": True,
            "text": None,
        }
    )
    sys.exit(0)

emit(
    {
        "path": raw_path,
        "size": size,
        "truncated": truncated,
        "binary": False,
        "text": text,
    }
)
"""

_UPLOAD_SCRIPT = """
import base64
import json
import subprocess
import sys
from pathlib import Path


BEGIN = "<<<DIFY_SANDBOX_BEGIN>>>"
END = "<<<DIFY_SANDBOX_END>>>"


def emit(payload):
    blob = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    print(BEGIN + blob + END)


raw_path = sys.argv[1]
target = Path(raw_path).resolve()
if not target.exists():
    emit({"error": "sandbox_path_not_found", "message": "path not found in sandbox"})
    sys.exit(0)
if not target.is_file():
    emit({"error": "sandbox_path_not_readable", "message": "path is not a readable file"})
    sys.exit(0)

command = ["dify-agent", "file", "upload", raw_path]
completed = subprocess.run(command, capture_output=True, text=True, check=False)
if completed.returncode != 0:
    emit(
        {
            "error": "agent_stub_upload_failed",
            "message": (completed.stderr or completed.stdout or f"upload exited with code {completed.returncode}").strip(),
        }
    )
    sys.exit(0)

try:
    file_mapping = json.loads(completed.stdout)
except ValueError as exc:
    emit({"error": "agent_stub_upload_failed", "message": f"upload returned invalid JSON: {exc}"})
    sys.exit(0)

emit({"path": raw_path, "file": file_mapping})
"""


class SandboxFileError(Exception):
    """Sandbox file failure mapped to HTTP by the FastAPI route layer."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class SandboxFileService:
    """Execute fixed sandbox file operations through the saved shell session."""

    layer_providers: tuple[DifyAgentLayerProvider, ...]

    async def list_files(self, request: SandboxListRequest) -> SandboxListResponse:
        normalized_path = _normalize_sandbox_path(request.path, allow_current_directory=True)
        payload = await self._run_locator_script(
            request.locator,
            script_source=_LIST_SCRIPT,
            args=[normalized_path, str(_LIST_MAX_ENTRIES)],
            timeout=_LIST_TIMEOUT_SECONDS,
            inject_agent_stub_env=False,
        )
        return _validate_response_model(SandboxListResponse, payload)

    async def read_file(self, request: SandboxReadRequest) -> SandboxReadResponse:
        normalized_path = _normalize_sandbox_path(request.path, allow_current_directory=False)
        payload = await self._run_locator_script(
            request.locator,
            script_source=_READ_SCRIPT,
            args=[normalized_path, str(request.max_bytes)],
            timeout=_READ_TIMEOUT_SECONDS,
            inject_agent_stub_env=False,
        )
        return _validate_response_model(SandboxReadResponse, payload)

    async def upload_file(self, request: SandboxUploadRequest) -> SandboxUploadResponse:
        normalized_path = _normalize_sandbox_path(request.path, allow_current_directory=False)
        payload = await self._run_locator_script(
            request.locator,
            script_source=_UPLOAD_SCRIPT,
            args=[normalized_path],
            timeout=_UPLOAD_TIMEOUT_SECONDS,
            inject_agent_stub_env=True,
        )
        return _validate_response_model(SandboxUploadResponse, payload)

    async def _run_locator_script(
        self,
        locator: SandboxLocator,
        *,
        script_source: str,
        args: list[str],
        timeout: float,
        inject_agent_stub_env: bool,
    ) -> dict[str, object]:
        try:
            graph_config, layer_configs = normalize_composition(locator.composition)
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            async with compositor.enter(configs=layer_configs, session_snapshot=locator.session_snapshot) as run:
                run.suspend_on_exit()
                shell_layer = run.get_layer("shell", DifyShellLayer)
                result = await shell_layer.run_remote_script_complete(
                    _build_python_script_command(script_source=script_source, args=args),
                    timeout=timeout,
                    inject_agent_stub_env=inject_agent_stub_env,
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise SandboxFileError("invalid_sandbox_locator", str(exc), status_code=400) from exc
        except RuntimeError as exc:
            raise SandboxFileError("sandbox_command_failed", str(exc), status_code=502) from exc

        return _decode_sandbox_payload(result)


def _normalize_sandbox_path(path: str, *, allow_current_directory: bool) -> str:
    """Reject only syntactically unsafe paths and preserve relative traversal.

    The remote scripts run with the saved workspace cwd, so ``../`` remains a
    valid sandbox-relative path when callers need to reach sibling directories.
    """

    normalized = (path or "").strip()
    if normalized in {"", ".", "./"}:
        if allow_current_directory:
            return "."
        raise SandboxFileError("invalid_sandbox_path", "path must not be blank", status_code=400)
    if normalized.startswith("/") or normalized.startswith("~"):
        raise SandboxFileError(
            "invalid_sandbox_path", "path must be relative to the sandbox workspace", status_code=400
        )
    if "\x00" in normalized or any(ord(ch) < 0x20 for ch in normalized):
        raise SandboxFileError("invalid_sandbox_path", "path contains unsupported control characters", status_code=400)
    return normalized


def _build_python_script_command(*, script_source: str, args: list[str]) -> str:
    quoted_args = " ".join(shlex.quote(value) for value in args)
    script = textwrap.dedent(script_source).strip()
    return f"python3 - {quoted_args} <<'PY'\n{script}\nPY"


def _decode_sandbox_payload(result: CompleteRemoteCommandResult) -> dict[str, object]:
    if result.exit_code not in (0, None):
        raise SandboxFileError(
            "sandbox_command_failed",
            "sandbox command exited with code " + f"{result.exit_code}: {_shell_result_details(result)}",
            status_code=502,
        )
    begin = result.output.find(_OUTPUT_BEGIN)
    end = result.output.find(_OUTPUT_END, begin + len(_OUTPUT_BEGIN)) if begin != -1 else -1
    if begin == -1 or end == -1:
        if not result.output_complete:
            raise SandboxFileError(
                "sandbox_command_failed",
                "sandbox command output incomplete before framed payload was captured: "
                + _shell_result_details(result),
                status_code=502,
            )
        raise SandboxFileError(
            "sandbox_command_failed",
            "sandbox command returned no framed payload",
            status_code=502,
        )
    blob = result.output[begin + len(_OUTPUT_BEGIN) : end]
    compact = "".join(blob.split())
    try:
        decoded = base64.b64decode(compact, validate=True)
        loaded = cast(object, json.loads(decoded.decode("utf-8")))
    except (binascii.Error, ValueError) as exc:
        if not result.output_complete:
            raise SandboxFileError(
                "sandbox_command_failed",
                "sandbox command output incomplete while decoding framed payload: " + _shell_result_details(result),
                status_code=502,
            ) from exc
        raise SandboxFileError(
            "sandbox_command_failed",
            f"sandbox command returned invalid framed payload: {exc}",
            status_code=502,
        ) from exc
    if not isinstance(loaded, dict):
        if not result.output_complete:
            raise SandboxFileError(
                "sandbox_command_failed",
                "sandbox command output incomplete while validating framed payload object: "
                + _shell_result_details(result),
                status_code=502,
            )
        raise SandboxFileError(
            "sandbox_command_failed", "sandbox command returned a non-object payload", status_code=502
        )
    payload = cast(dict[str, object], loaded)
    error = payload.get("error")
    if isinstance(error, str):
        status_code = (
            404
            if error in {"sandbox_not_found", "sandbox_path_not_found"}
            else 502
            if error == "agent_stub_upload_failed"
            else 400
        )
        if error in {"sandbox_command_failed", "agent_stub_upload_failed"}:
            status_code = 502
        message = payload.get("message")
        raise SandboxFileError(
            error,
            str(message) if isinstance(message, str) and message else error,
            status_code=status_code,
        )
    return payload


def _shell_result_details(result: CompleteRemoteCommandResult) -> str:
    details = (
        f"output_complete={result.output_complete} "
        + f"incomplete_reason={result.incomplete_reason} "
        + f"output_path={result.output_path}"
    )
    if not result.output:
        return details
    return details + "\n" + _bounded_output_tail(result.output)


def _bounded_output_tail(output: str) -> str:
    tail = utf8_suffix(output, _SHELL_RESULT_OUTPUT_TAIL_BYTES)
    if tail == output:
        return output
    return f"... (showing last {_SHELL_RESULT_OUTPUT_TAIL_BYTES} bytes of raw output) ...\n{tail}"


def _validate_response_model(
    model_type: type[ResponseModelT],
    payload: dict[str, object],
) -> ResponseModelT:
    try:
        return model_type.model_validate(payload)
    except ValidationError as exc:
        raise SandboxFileError(
            "sandbox_command_failed", f"sandbox command returned invalid payload: {exc}", status_code=502
        ) from exc


__all__ = ["SandboxFileError", "SandboxFileService"]
