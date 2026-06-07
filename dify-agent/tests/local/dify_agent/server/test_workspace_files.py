"""Unit tests for the read-only workspace file inspector (agent-backend side).

A fake shellctl client returns reader-style output (base64-of-JSON between
sentinels) so the tests cover decode/error-mapping/paging and PTY-newline
tolerance without a live shellctl.
"""

from __future__ import annotations

import asyncio
import base64
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shell_session_manager.shellctl.shared import JobResult, JobStatusName

from dify_agent.server.routes.workspace_files import create_workspace_files_router
from dify_agent.server.workspace_files import (
    _BEGIN,
    _END,
    WorkspaceFileError,
    WorkspaceFileService,
    _validate_rel_path,
)

SID = "abc1234"  # valid 5+2 lowercase hex


def _wrap(payload: dict[str, object], *, pty_wrap: int = 0, noise: bool = True) -> str:
    """Render a reader result the way the in-workspace Python reader would."""
    blob = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    if pty_wrap:
        blob = "\n".join(blob[i : i + pty_wrap] for i in range(0, len(blob), pty_wrap))
    body = f"{_BEGIN}{blob}{_END}\n"
    if noise:
        body = f"user@host:~/workspace/{SID}$ python3 -c ...\r\n" + body + f"user@host:~/workspace/{SID}$ \r\n"
    return body


class FakeShellctlClient:
    """Returns queued output windows; records cleanup calls."""

    def __init__(self, windows: list[str]) -> None:
        self.windows = windows
        self._cursor = 0
        self.run_scripts: list[str] = []
        self.deleted: list[str] = []
        self.closed = False

    def _result(self, chunk: str, *, last: bool) -> JobResult:
        return JobResult(
            job_id="job-1",
            done=last,
            status=JobStatusName.EXITED,
            exit_code=0,
            output_path="/tmp/job-1.out",
            output=chunk,
            offset=64 * (self._cursor + 1),
            truncated=not last,
        )

    async def run(self, script: str, *, timeout: float = 30.0, terminal: object | None = None) -> JobResult:
        del timeout, terminal
        self.run_scripts.append(script)
        self._cursor = 0
        return self._result(self.windows[0], last=len(self.windows) == 1)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 30.0) -> JobResult:
        del job_id, offset, timeout
        self._cursor += 1
        chunk = self.windows[self._cursor]
        return self._result(chunk, last=self._cursor == len(self.windows) - 1)

    async def delete(self, job_id: str, *, force: bool = False) -> object:
        del force
        self.deleted.append(job_id)
        return {"deleted": True}

    async def close(self) -> None:
        self.closed = True


def _service(windows: list[str]) -> tuple[WorkspaceFileService, FakeShellctlClient]:
    fake = FakeShellctlClient(windows)
    service = WorkspaceFileService(shellctl_entrypoint="http://shellctl", client_factory=lambda: fake)
    return service, fake


# --- service: happy paths ------------------------------------------------------


def test_list_dir_returns_entries_and_cleans_up() -> None:
    payload = {
        "entries": [
            {"name": "notes.txt", "type": "file", "size": 12, "mtime": 1700000000},
            {"name": "sub", "type": "dir", "size": 4096, "mtime": 1700000001},
        ],
        "truncated": False,
    }
    service, fake = _service([_wrap(payload)])

    result = asyncio.run(service.list_dir(SID, "."))

    assert [e.name for e in result.entries] == ["notes.txt", "sub"]
    assert result.entries[1].type == "dir"
    assert result.truncated is False
    # cleanup: read job deleted and client closed
    assert fake.deleted == ["job-1"]
    assert fake.closed is True


def test_preview_text_decodes_content() -> None:
    content = "hello ZEBRA\nsecond line\n"
    payload = {
        "size": len(content),
        "truncated": False,
        "binary": False,
        "content_base64": base64.b64encode(content.encode()).decode(),
    }
    service, _ = _service([_wrap(payload)])

    result = asyncio.run(service.preview(SID, "notes.txt"))

    assert result.binary is False
    assert result.text == content
    assert result.size == len(content)


def test_preview_binary_has_no_text() -> None:
    payload = {"size": 300, "truncated": True, "binary": True, "content_base64": base64.b64encode(b"\x00\x01").decode()}
    service, _ = _service([_wrap(payload)])

    result = asyncio.run(service.preview(SID, "blob.bin"))

    assert result.binary is True
    assert result.text is None
    assert result.truncated is True


def test_download_roundtrips_bytes() -> None:
    raw = bytes(range(256))
    payload = {"size": len(raw), "truncated": False, "content_base64": base64.b64encode(raw).decode()}
    service, _ = _service([_wrap(payload)])

    result = asyncio.run(service.download(SID, "sub/data.bin"))

    assert base64.b64decode(result.content_base64) == raw
    assert result.size == 256


# --- service: PTY tolerance + paging ------------------------------------------


def test_decode_tolerates_pty_inserted_newlines() -> None:
    raw = bytes(range(200))
    payload = {"size": len(raw), "truncated": False, "content_base64": base64.b64encode(raw).decode()}
    # wrap the base64 blob every 10 chars with newlines, as a narrow PTY would
    service, _ = _service([_wrap(payload, pty_wrap=10)])

    result = asyncio.run(service.download(SID, "blob.bin"))

    assert base64.b64decode(result.content_base64) == raw


def test_reads_across_multiple_output_windows() -> None:
    raw = bytes(range(128))
    payload = {"size": len(raw), "truncated": False, "content_base64": base64.b64encode(raw).decode()}
    full = _wrap(payload, noise=False)
    third = len(full) // 3
    windows = [full[:third], full[third : 2 * third], full[2 * third :]]
    service, fake = _service(windows)

    result = asyncio.run(service.download(SID, "blob.bin"))

    assert base64.b64decode(result.content_base64) == raw
    assert fake._cursor == 2  # paged through all three windows


# --- service: error mapping ----------------------------------------------------


@pytest.mark.parametrize(
    ("error_code", "status"),
    [
        ("workspace_not_found", 404),
        ("not_found", 404),
        ("path_escape", 400),
        ("not_a_directory", 400),
        ("is_a_directory", 400),
    ],
)
def test_reader_error_maps_to_status(error_code: str, status: int) -> None:
    service, _ = _service([_wrap({"error": error_code})])

    with pytest.raises(WorkspaceFileError) as exc_info:
        asyncio.run(service.list_dir(SID, "."))

    assert exc_info.value.code == error_code
    assert exc_info.value.status_code == status


def test_invalid_session_id_rejected_before_any_shell_call() -> None:
    service, fake = _service([_wrap({"entries": [], "truncated": False})])

    with pytest.raises(WorkspaceFileError) as exc_info:
        asyncio.run(service.list_dir("NOTHEX", "."))

    assert exc_info.value.code == "invalid_session_id"
    assert exc_info.value.status_code == 400
    assert fake.run_scripts == []  # never reached shellctl


def test_missing_sentinel_is_reader_failure() -> None:
    service, _ = _service(["command not found: python3\r\n"])

    with pytest.raises(WorkspaceFileError) as exc_info:
        asyncio.run(service.list_dir(SID, "."))

    assert exc_info.value.code == "reader_failed"
    assert exc_info.value.status_code == 502


# --- path validation -----------------------------------------------------------


@pytest.mark.parametrize("good", [".", "", "notes.txt", "sub/inner.txt", "a/b/c.json"])
def test_validate_rel_path_accepts(good: str) -> None:
    _validate_rel_path(good)


@pytest.mark.parametrize("bad", ["/etc/passwd", "../escape", "sub/../../etc", "~/secrets", "a/\x00b"])
def test_validate_rel_path_rejects(bad: str) -> None:
    with pytest.raises(WorkspaceFileError):
        _validate_rel_path(bad)


# --- router --------------------------------------------------------------------


def _client(service: WorkspaceFileService | None) -> TestClient:
    app = FastAPI()
    app.include_router(create_workspace_files_router(lambda: service))
    return TestClient(app)


def test_router_list_ok() -> None:
    payload = {"entries": [{"name": "a.txt", "type": "file", "size": 1, "mtime": 1}], "truncated": False}
    service, _ = _service([_wrap(payload)])

    response = _client(service).get(f"/workspaces/{SID}/files", params={"path": "."})

    assert response.status_code == 200
    assert response.json()["entries"][0]["name"] == "a.txt"


def test_router_maps_reader_error_to_status() -> None:
    service, _ = _service([_wrap({"error": "not_found"})])

    response = _client(service).get(f"/workspaces/{SID}/files/preview", params={"path": "missing.txt"})

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


def test_router_returns_503_when_inspector_unconfigured() -> None:
    response = _client(None).get(f"/workspaces/{SID}/files", params={"path": "."})

    assert response.status_code == 503
