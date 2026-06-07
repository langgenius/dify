"""Read-only inspector for a shell-layer workspace (``~/workspace/<session_id>``).

The ``dify.shell`` layer runs the agent's bash in a per-session workspace that
lives on the shellctl host. shellctl exposes only job control (run/wait/...), so
there is no native file API: the only way to read those files is to run a
read-only command inside the workspace and capture its output.

This service does exactly that, safely:

* It runs a fixed Python reader (no shell parsing of user input) via
  ``ShellctlClient.run``. The reader is delivered base64-encoded and all
  user-controlled values (workspace root, relative path, op, size caps) are
  passed through the environment, never interpolated into the command.
* Path containment is enforced inside the reader with ``realpath`` against the
  workspace root, so ``..`` and symlink escapes are rejected.
* The reader emits its result as a single base64 blob between sentinels. base64
  tolerates the newlines a PTY inserts when wrapping long lines, so the payload
  survives tmux capture intact; we strip whitespace before decoding.

Only listing, text/binary preview, and download are supported; everything is
read-only and scoped to the workspace.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol, cast

from pydantic import BaseModel, Field
from shell_session_manager.shellctl.client import ShellctlClient, ShellctlClientError
from shell_session_manager.shellctl.shared import MAX_OUTPUT_LIMIT_BYTES, JobResult, TerminalSize

logger = logging.getLogger(__name__)

# Mirrors the dify.shell layer's workspace session-id contract (5+2 lowercase
# hex). Kept local so this read-only inspector does not depend on the layer's
# private helpers; the layer remains the source of truth for the format.
_SESSION_ID_PATTERN = re.compile(r"^[0-9a-f]{7}$")

# Result sentinels emitted by the reader; chosen to be PTY/shell-noise resistant.
_BEGIN = "<<<DIFY_FS_BEGIN>>>"
_END = "<<<DIFY_FS_END>>>"

# Conservative read caps (tunable). The download cap leaves headroom under the
# 1 MiB shellctl output window after base64 + JSON overhead, paged when needed.
PREVIEW_MAX_BYTES = 256 * 1024
DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024
LIST_MAX_ENTRIES = 1000
_READ_TIMEOUT_SECONDS = 20.0
# Upper bound on output windows paged per request (backstop against a runaway
# job); DOWNLOAD_MAX_BYTES of base64 fits comfortably within this many 1 MiB windows.
_MAX_OUTPUT_WINDOWS = 64

# Fixed Python reader. Receives all inputs via the environment so no user value
# is ever interpolated into a shell command. Emits one base64 blob of JSON
# between the sentinels.
_READER_SOURCE = """
import base64, json, os, stat, sys

BEGIN = "<<<DIFY_FS_BEGIN>>>"
END = "<<<DIFY_FS_END>>>"


def emit(obj):
    blob = base64.b64encode(json.dumps(obj).encode("utf-8")).decode("ascii")
    sys.stdout.write(BEGIN + blob + END + "\\n")
    sys.stdout.flush()


op = os.environ.get("DIFY_FS_OP", "")
root = os.path.realpath(os.path.expanduser(os.environ.get("DIFY_FS_ROOT", "")))
rel = os.environ.get("DIFY_FS_REL", "")
max_bytes = int(os.environ.get("DIFY_FS_MAX", "0") or "0")
list_limit = int(os.environ.get("DIFY_FS_LIST_LIMIT", "1000") or "1000")

if not os.path.isdir(root):
    emit({"error": "workspace_not_found"})
    sys.exit(0)

target = os.path.realpath(os.path.join(root, rel))
if target != root and not target.startswith(root + os.sep):
    emit({"error": "path_escape"})
    sys.exit(0)
if not os.path.exists(target):
    emit({"error": "not_found"})
    sys.exit(0)


def entry_for(name, p):
    st = os.lstat(p)
    mode = st.st_mode
    if stat.S_ISLNK(mode):
        etype = "symlink"
    elif stat.S_ISDIR(mode):
        etype = "dir"
    else:
        etype = "file"
    return {"name": name, "type": etype, "size": int(st.st_size), "mtime": int(st.st_mtime)}


if op == "list":
    if not os.path.isdir(target):
        emit({"error": "not_a_directory"})
        sys.exit(0)
    names = sorted(os.listdir(target))
    truncated = len(names) > list_limit
    entries = [entry_for(n, os.path.join(target, n)) for n in names[:list_limit]]
    emit({"entries": entries, "truncated": truncated})
elif op in ("preview", "download"):
    if os.path.isdir(target):
        emit({"error": "is_a_directory"})
        sys.exit(0)
    size = int(os.path.getsize(target))
    with open(target, "rb") as f:
        data = f.read(max_bytes + 1)
    truncated = len(data) > max_bytes
    data = data[:max_bytes]
    content_b64 = base64.b64encode(data).decode("ascii")
    payload = {"size": size, "truncated": truncated, "content_base64": content_b64}
    if op == "preview":
        try:
            data.decode("utf-8")
            payload["binary"] = False
        except UnicodeDecodeError:
            payload["binary"] = True
    emit(payload)
else:
    emit({"error": "bad_op"})
    sys.exit(0)
"""

_READER_B64 = base64.b64encode(_READER_SOURCE.encode("utf-8")).decode("ascii")


class WorkspaceFileError(Exception):
    """Read failure mapped to an HTTP status by the route layer."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


# error code emitted by the reader -> (http status, client message)
_READER_ERROR_HTTP: dict[str, tuple[int, str]] = {
    "workspace_not_found": (404, "workspace does not exist"),
    "not_found": (404, "path not found in workspace"),
    "path_escape": (400, "path escapes the workspace"),
    "not_a_directory": (400, "path is not a directory"),
    "is_a_directory": (400, "path is a directory"),
    "bad_op": (400, "unsupported operation"),
}


class WorkspaceFileEntry(BaseModel):
    """One entry in a workspace directory listing."""

    name: str
    type: Literal["file", "dir", "symlink"]
    size: int
    mtime: int


class WorkspaceListResponse(BaseModel):
    """Directory listing of a workspace path."""

    path: str
    entries: list[WorkspaceFileEntry]
    truncated: bool = Field(description="True when the directory had more than LIST_MAX_ENTRIES entries.")


class WorkspacePreviewResponse(BaseModel):
    """Inline preview of a workspace file."""

    path: str
    size: int
    truncated: bool
    binary: bool
    # text is omitted for binary files
    text: str | None = None


class WorkspaceDownloadResponse(BaseModel):
    """Raw bytes (base64) of a workspace file for download."""

    path: str
    size: int
    truncated: bool
    content_base64: str


class ShellctlReadClient(Protocol):
    """The shellctl job-control surface this read-only inspector relies on."""

    async def run(self, script: str, *, timeout: float = ..., terminal: TerminalSize | None = ...) -> JobResult: ...

    async def wait(self, job_id: str, *, offset: int, timeout: float = ...) -> JobResult: ...

    async def delete(self, job_id: str, *, force: bool = ...) -> object: ...

    async def close(self) -> None: ...


ShellctlReadClientFactory = Callable[[], ShellctlReadClient]


@dataclass(slots=True)
class WorkspaceFileService:
    """Run read-only workspace inspection commands through shellctl."""

    shellctl_entrypoint: str
    shellctl_auth_token: str | None = None
    client_factory: ShellctlReadClientFactory | None = None

    def _client(self) -> ShellctlReadClient:
        if self.client_factory is not None:
            return self.client_factory()
        return ShellctlClient(
            self.shellctl_entrypoint,
            token=self.shellctl_auth_token,
            output_limit=MAX_OUTPUT_LIMIT_BYTES,
        )

    async def list_dir(self, session_id: str, path: str) -> WorkspaceListResponse:
        data = await self._read(session_id, op="list", path=path)
        raw_entries = data.get("entries", [])
        entries_in = cast(list[object], raw_entries) if isinstance(raw_entries, list) else []
        entries = [WorkspaceFileEntry.model_validate(e) for e in entries_in]
        return WorkspaceListResponse(
            path=_normalize_path(path), entries=entries, truncated=_payload_bool(data.get("truncated"))
        )

    async def preview(self, session_id: str, path: str) -> WorkspacePreviewResponse:
        data = await self._read(session_id, op="preview", path=path, max_bytes=PREVIEW_MAX_BYTES)
        binary = _payload_bool(data.get("binary"))
        text: str | None = None
        if not binary:
            text = base64.b64decode(_payload_str(data.get("content_base64"))).decode("utf-8", errors="replace")
        return WorkspacePreviewResponse(
            path=_normalize_path(path),
            size=_payload_int(data.get("size")),
            truncated=_payload_bool(data.get("truncated")),
            binary=binary,
            text=text,
        )

    async def download(self, session_id: str, path: str) -> WorkspaceDownloadResponse:
        data = await self._read(session_id, op="download", path=path, max_bytes=DOWNLOAD_MAX_BYTES)
        return WorkspaceDownloadResponse(
            path=_normalize_path(path),
            size=_payload_int(data.get("size")),
            truncated=_payload_bool(data.get("truncated")),
            content_base64=_payload_str(data.get("content_base64")),
        )

    async def _read(self, session_id: str, *, op: str, path: str, max_bytes: int = 0) -> dict[str, object]:
        safe_session_id = self._validate_session_id(session_id)
        rel = _validate_rel_path(path)
        script = _build_reader_command(session_id=safe_session_id, op=op, rel=rel, max_bytes=max_bytes)

        client = self._client()
        job_id: str | None = None
        try:
            result = await client.run(
                script,
                timeout=_READ_TIMEOUT_SECONDS,
                terminal=TerminalSize(cols=4096, rows=200),
            )
            job_id = result.job_id
            output = result.output
            offset = result.offset
            windows = 1
            while _END not in output and (result.truncated or not result.done) and windows < _MAX_OUTPUT_WINDOWS:
                result = await client.wait(job_id, offset=offset, timeout=_READ_TIMEOUT_SECONDS)
                output += result.output
                offset = result.offset
                windows += 1
            return _decode_blob(output)
        except ShellctlClientError as exc:
            raise WorkspaceFileError("shellctl_error", exc.message, status_code=502) from exc
        finally:
            if job_id is not None:
                try:
                    _ = await client.delete(job_id, force=True)
                except ShellctlClientError as exc:
                    if exc.code != "job_not_found":
                        logger.warning("failed to delete workspace read job %s: %s", job_id, exc)
            await client.close()

    @staticmethod
    def _validate_session_id(session_id: str) -> str:
        if not _SESSION_ID_PATTERN.fullmatch(session_id):
            raise WorkspaceFileError(
                "invalid_session_id",
                "session_id must match the 5+2 lowercase hex format '<5 hex><2 hex>'.",
                status_code=400,
            )
        return session_id


def _decode_blob(output: str) -> dict[str, object]:
    start = output.find(_BEGIN)
    end = output.find(_END, start + len(_BEGIN)) if start != -1 else -1
    if start == -1 or end == -1:
        snippet = output[-200:].strip()
        raise WorkspaceFileError(
            "reader_failed",
            f"workspace reader produced no result (output tail: {snippet!r})",
            status_code=502,
        )
    blob = output[start + len(_BEGIN) : end]
    compact = "".join(blob.split())  # strip PTY-injected whitespace/newlines
    try:
        decoded = base64.b64decode(compact, validate=True)
        loaded = cast(object, json.loads(decoded.decode("utf-8")))
    except (binascii.Error, ValueError) as exc:
        raise WorkspaceFileError(
            "reader_failed", f"could not decode workspace reader output: {exc}", status_code=502
        ) from exc
    if not isinstance(loaded, dict):
        raise WorkspaceFileError("reader_failed", "workspace reader returned a non-object payload", status_code=502)
    data = cast(dict[str, object], loaded)
    error = data.get("error")
    if isinstance(error, str):
        status, message = _READER_ERROR_HTTP.get(error, (400, error))
        raise WorkspaceFileError(error, message, status_code=status)
    return data


def _payload_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError as exc:
            raise WorkspaceFileError(
                "reader_failed", "workspace reader returned a non-integer field", status_code=502
            ) from exc
    raise WorkspaceFileError("reader_failed", "workspace reader returned a non-integer field", status_code=502)


def _payload_str(value: object) -> str:
    if isinstance(value, str):
        return value
    raise WorkspaceFileError("reader_failed", "workspace reader returned a non-string field", status_code=502)


def _payload_bool(value: object) -> bool:
    return bool(value)


def _build_reader_command(*, session_id: str, op: str, rel: str, max_bytes: int) -> str:
    """Build the shell command: fixed base64 reader + user data via the environment."""
    # session_id is validated lowercase hex, so the workspace root literal is injection-safe.
    root = f"~/workspace/{session_id}"
    env = (
        f"DIFY_FS_OP={_shquote(op)} "
        f"DIFY_FS_ROOT={_shquote(root)} "
        f"DIFY_FS_REL={_shquote(rel)} "
        f"DIFY_FS_MAX={int(max_bytes)} "
        f"DIFY_FS_LIST_LIMIT={LIST_MAX_ENTRIES}"
    )
    return f"{env} python3 -c 'import base64;exec(base64.b64decode(\"{_READER_B64}\"))'"


def _shquote(value: str) -> str:
    """Single-quote a value for POSIX shells, escaping embedded single quotes."""
    return "'" + value.replace("'", "'\\''") + "'"


def _normalize_path(path: str) -> str:
    return path.strip().lstrip("/") or "."


def _validate_rel_path(path: str) -> str:
    """Reject absolute paths, parent traversal, and control characters early.

    Containment is also enforced inside the reader via realpath; this is a cheap
    first gate and keeps obviously-bad input from reaching the workspace at all.
    """
    rel = (path or "").strip()
    if rel in ("", ".", "./"):
        return "."
    if rel.startswith("/") or rel.startswith("~"):
        raise WorkspaceFileError("invalid_path", "path must be relative to the workspace", status_code=400)
    if "\x00" in rel or any(ord(ch) < 0x20 for ch in rel):
        raise WorkspaceFileError("invalid_path", "path contains control characters", status_code=400)
    segments = rel.split("/")
    if any(seg == ".." for seg in segments):
        raise WorkspaceFileError("invalid_path", "path must not traverse outside the workspace", status_code=400)
    return rel


__all__ = [
    "DOWNLOAD_MAX_BYTES",
    "LIST_MAX_ENTRIES",
    "PREVIEW_MAX_BYTES",
    "WorkspaceDownloadResponse",
    "WorkspaceFileEntry",
    "WorkspaceFileError",
    "WorkspaceFileService",
    "WorkspaceListResponse",
    "WorkspacePreviewResponse",
]
