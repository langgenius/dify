"""Local tests for the shellctl shell adapter and env-driven provider factory."""

from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from typing import cast

import httpx2 as httpx
import pytest
from shellctl.client import ShellctlClientError

from dify_agent.adapters.shell import shellctl
from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellProviderError
from dify_agent.adapters.shell.shellctl import (
    ShellctlClientProtocol,
    ShellctlCommands,
    ShellFileTransferError,
    ShellctlFileTransfer,
)
from dify_agent.runtime_backend.errors import WorkspaceFileTooLargeError

_WORKSPACE_SCRIPT_TIMEOUT_SECONDS = 5.0


@dataclass(slots=True)
class _Job:
    job_id: str
    status: str = "running"
    done: bool = True
    output: str = ""
    offset: int = 0
    truncated: bool = False
    exit_code: int | None = 0
    output_path: str | None = "/tmp/output.log"


@dataclass(slots=True)
class _Status:
    job_id: str
    status: str = "terminated"
    done: bool = True
    offset: int = 0
    exit_code: int | None = 130


@dataclass(slots=True)
class _RunCall:
    script: str
    cwd: str | None
    env: dict[str, str] | None
    timeout: float


type _RunHandler = Callable[[str, str | None, dict[str, str] | None, float], _Job]
type _WaitHandler = Callable[[str, int, float], _Job]
type _InputHandler = Callable[[str, str, int, float], _Job]
type _TerminateHandler = Callable[[str, float], _Status]


@dataclass(slots=True)
class FakeShellctlClient:
    run_handler: _RunHandler | None = None
    wait_handler: _WaitHandler | None = None
    input_handler: _InputHandler | None = None
    tail_handler: Callable[[str], _Job] | None = None
    terminate_handler: _TerminateHandler | None = None
    run_calls: list[_RunCall] = field(default_factory=list)
    wait_calls: list[tuple[str, int, float]] = field(default_factory=list)
    input_calls: list[tuple[str, str, int, float]] = field(default_factory=list)
    terminate_calls: list[tuple[str, float]] = field(default_factory=list)
    delete_calls: list[tuple[str, bool, float | None]] = field(default_factory=list)
    closed: bool = False

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> _Job:
        self.run_calls.append(_RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        if self.run_handler is not None:
            return self.run_handler(script, cwd, env, timeout)
        return _Job(job_id="job", status="exited", done=True, exit_code=0)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 30.0) -> _Job:
        self.wait_calls.append((job_id, offset, timeout))
        if self.wait_handler is not None:
            return self.wait_handler(job_id, offset, timeout)
        return _Job(job_id=job_id, status="exited", done=True, offset=offset, exit_code=0)

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float = 30.0,
    ) -> _Job:
        self.input_calls.append((job_id, text, offset, timeout))
        if self.input_handler is not None:
            return self.input_handler(job_id, text, offset, timeout)
        return _Job(job_id=job_id, status="exited", done=True, offset=offset, exit_code=0)

    async def tail(self, job_id: str) -> _Job:
        if self.tail_handler is not None:
            return self.tail_handler(job_id)
        return _Job(job_id=job_id, status="exited", done=True, output="", exit_code=0)

    async def terminate(self, job_id: str, grace_seconds: float = 10.0) -> _Status:
        self.terminate_calls.append((job_id, grace_seconds))
        if self.terminate_handler is not None:
            return self.terminate_handler(job_id, grace_seconds)
        return _Status(job_id=job_id)

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None:
        self.delete_calls.append((job_id, force, grace_seconds))
        return None

    async def close(self) -> None:
        self.closed = True


def _client_protocol(client: FakeShellctlClient) -> ShellctlClientProtocol:
    return cast(ShellctlClientProtocol, cast(object, client))


def _kill_process_group(process: subprocess.Popen[str]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _run_workspace_source(source: str, args: list[str]) -> dict[str, object]:
    process = subprocess.Popen(
        [sys.executable, "-c", source, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=_WORKSPACE_SCRIPT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        _kill_process_group(process)
        _ = process.communicate()
        pytest.fail(f"workspace script exceeded {_WORKSPACE_SCRIPT_TIMEOUT_SECONDS:g}s test timeout")
    except BaseException:
        _kill_process_group(process)
        _ = process.communicate()
        raise
    assert process.returncode == 0, stderr
    begin = stdout.find(shellctl._WORKSPACE_PAYLOAD_BEGIN)
    end = stdout.find(shellctl._WORKSPACE_PAYLOAD_END, begin + len(shellctl._WORKSPACE_PAYLOAD_BEGIN))
    assert begin >= 0 and end >= 0
    encoded = "".join(stdout[begin + len(shellctl._WORKSPACE_PAYLOAD_BEGIN) : end].split())
    payload = json.loads(base64.b64decode(encoded, validate=True))
    assert isinstance(payload, dict)
    return cast(dict[str, object], payload)


def _inject_workspace_checkpoint(source: str, checkpoint: str, injected_source: str) -> str:
    marker = f"# DIFY_WORKSPACE_CHECKPOINT: {checkpoint}"
    assert source.count(marker) == 1
    marker_index = source.index(marker)
    line_start = source.rfind("\n", 0, marker_index) + 1
    indentation = source[line_start:marker_index]
    assert not indentation.strip()
    target = f"{indentation}{marker}"
    injected = "\n".join(f"{indentation}{line}" if line else "" for line in injected_source.splitlines())
    instrumented = source.replace(target, f"{injected}\n{target}", 1)
    assert instrumented != source
    assert instrumented.count(marker) == 1
    return instrumented


def test_workspace_read_holds_open_fd_across_concurrent_symlink_swap(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    reports = workspace / "reports"
    reports.mkdir(parents=True)
    source = reports / "result.pdf"
    _ = source.write_text("workspace-content")
    outside = tmp_path / "outside.pdf"
    _ = outside.write_text("outside-content")
    instrumented = _inject_workspace_checkpoint(
        shellctl._READ_WORKSPACE_SCRIPT,
        "file_opened",
        "os.unlink(sys.argv[4])\nos.symlink(sys.argv[5], sys.argv[4])",
    )

    payload = _run_workspace_source(
        instrumented,
        [str(workspace), "reports/result.pdf", "1024", str(source), str(outside)],
    )

    assert payload["text"] == "workspace-content"
    assert source.is_symlink()


def test_workspace_read_bytes_holds_open_fd_across_same_uid_symlink_swap(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    reports = workspace / "reports"
    reports.mkdir(parents=True)
    source = reports / "result.pdf"
    source.write_bytes(b"workspace-content\x00")
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"outside-content")
    instrumented = _inject_workspace_checkpoint(
        shellctl._READ_WORKSPACE_BYTES_SCRIPT,
        "file_opened",
        "os.unlink(sys.argv[4])\nos.symlink(sys.argv[5], sys.argv[4])",
    )

    payload = _run_workspace_source(
        instrumented,
        [str(workspace), "reports/result.pdf", "1024", str(source), str(outside)],
    )

    encoded = payload["content_base64"]
    assert isinstance(encoded, str)
    assert base64.b64decode(encoded) == b"workspace-content\x00"
    assert source.is_symlink()


def test_workspace_read_bytes_accepts_file_at_size_limit(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "result.bin"
    source.write_bytes(b"12345")

    payload = _run_workspace_source(
        shellctl._READ_WORKSPACE_BYTES_SCRIPT,
        [str(workspace), "result.bin", "5"],
    )

    encoded = payload["content_base64"]
    assert isinstance(encoded, str)
    assert base64.b64decode(encoded) == b"12345"
    assert payload["size"] == 5


def test_workspace_read_bytes_rejects_oversize_before_remote_read(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "result.bin"
    source.write_bytes(b"123456")
    instrumented = _inject_workspace_checkpoint(
        shellctl._READ_WORKSPACE_BYTES_SCRIPT,
        "arguments_loaded",
        "os.read = lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('must not read'))\n\n"
    )

    payload = _run_workspace_source(
        instrumented,
        [str(workspace), "result.bin", "5"],
    )

    assert payload == {"path": "result.bin", "size": 6, "too_large": True}


def test_workspace_read_bytes_caps_capture_when_file_grows_after_fstat(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "result.bin"
    source.write_bytes(b"12345")
    instrumented = _inject_workspace_checkpoint(
        shellctl._READ_WORKSPACE_BYTES_SCRIPT,
        "arguments_loaded",
        "real_read = os.read\n"
        "captured_bytes = 0\n"
        "def bounded_read(fd, count):\n"
        "    global captured_bytes\n"
        "    data = real_read(fd, count)\n"
        "    captured_bytes += len(data)\n"
        "    assert captured_bytes <= int(sys.argv[3]) + 1\n"
        "    return data\n"
        "os.read = bounded_read",
    )
    instrumented = _inject_workspace_checkpoint(
        instrumented,
        "file_size_captured",
        "with open(sys.argv[4], 'ab') as growing:\n    growing.write(b'x' * 10000)",
    )

    payload = _run_workspace_source(
        instrumented,
        [str(workspace), "result.bin", "5", str(source)],
    )

    assert payload == {"path": "result.bin", "size": 6, "too_large": True}


def test_workspace_list_holds_open_directory_fd_across_concurrent_symlink_swap(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    reports = workspace / "reports"
    reports.mkdir(parents=True)
    _ = (reports / "safe.txt").write_text("safe")
    outside = tmp_path / "outside"
    outside.mkdir()
    _ = (outside / "secret.txt").write_text("secret")
    moved = workspace / "opened-reports"
    instrumented = _inject_workspace_checkpoint(
        shellctl._LIST_WORKSPACE_SCRIPT,
        "directory_opened",
        "os.rename(sys.argv[4], sys.argv[5])\nos.symlink(sys.argv[6], sys.argv[4])",
    )

    payload = _run_workspace_source(
        instrumented,
        [str(workspace), "reports", "100", str(reports), str(moved), str(outside)],
    )

    entries = payload["entries"]
    assert isinstance(entries, list)
    assert [entry["name"] for entry in entries if isinstance(entry, dict)] == ["safe.txt"]


def test_commands_forward_parameters_and_map_metadata() -> None:
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: _Job(
            job_id="run-job",
            status="running",
            done=False,
            output="abc",
            offset=3,
            truncated=True,
            exit_code=None,
            output_path="/tmp/run.log",
        ),
        wait_handler=lambda job_id, offset, timeout: _Job(
            job_id=job_id,
            status="running",
            done=False,
            output="def",
            offset=6,
            truncated=False,
            exit_code=None,
            output_path="/tmp/run.log",
        ),
        input_handler=lambda job_id, text, offset, timeout: _Job(
            job_id=job_id,
            status="exited",
            done=True,
            output="ghi",
            offset=9,
            truncated=False,
            exit_code=0,
            output_path="/tmp/run.log",
        ),
        tail_handler=lambda job_id: _Job(
            job_id=job_id,
            status="exited",
            done=True,
            output="tail",
            offset=11,
            truncated=False,
            exit_code=0,
            output_path="/tmp/tail.log",
        ),
        terminate_handler=lambda job_id, grace_seconds: _Status(
            job_id=job_id,
            status="terminated",
            done=True,
            offset=12,
            exit_code=130,
        ),
    )

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        run_result = await commands.run("pwd", cwd="~/workspace/abc12ff", env={"FOO": "bar"}, timeout=2.5)
        wait_result = await commands.wait("run-job", offset=3, timeout=4.0)
        read_result = await commands.read_output("run-job", offset=6)
        input_result = await commands.input("run-job", "ls\n", offset=6, timeout=5.0)
        interrupt_result = await commands.interrupt("run-job", grace_seconds=1.5)
        tail_result = await commands.tail("run-job")
        await commands.delete("run-job", force=True, grace_seconds=2.0)

        assert run_result == ShellCommandResult(
            job_id="run-job",
            status="running",
            done=False,
            exit_code=None,
            output="abc",
            offset=3,
            truncated=True,
            output_path="/tmp/run.log",
        )
        assert wait_result.offset == 6
        assert read_result.offset == 6
        assert input_result.exit_code == 0
        assert interrupt_result.status == "terminated"
        assert tail_result.output_path == "/tmp/tail.log"

    asyncio.run(scenario())

    assert client.run_calls == [_RunCall(script="pwd", cwd="~/workspace/abc12ff", env={"FOO": "bar"}, timeout=2.5)]
    assert client.wait_calls == [
        ("run-job", 3, 4.0),
        ("run-job", 6, 0.0),
    ]
    assert client.input_calls == [("run-job", "ls\n", 6, 5.0)]
    assert client.terminate_calls == [("run-job", 1.5)]
    assert client.delete_calls == [("run-job", True, 2.0)]


def test_commands_map_http_timeout_to_shell_provider_error() -> None:
    request = httpx.Request("POST", "http://shellctl.example/v1/jobs")
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: (_ for _ in ()).throw(
            httpx.ReadTimeout("timed out", request=request)
        )
    )

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        with pytest.raises(ShellProviderError, match="timed out") as exc_info:
            await commands.run("pwd", timeout=2.5)
        assert exc_info.value.code == "timeout"

    asyncio.run(scenario())


def test_commands_map_http_request_error_to_shell_provider_error() -> None:
    request = httpx.Request("POST", "http://shellctl.example/v1/jobs/run")
    client = FakeShellctlClient(
        wait_handler=lambda job_id, offset, timeout: (_ for _ in ()).throw(
            httpx.ConnectError("connection failed", request=request)
        )
    )

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        with pytest.raises(ShellProviderError, match="connection failed") as exc_info:
            await commands.wait("run-job", offset=3, timeout=4.0)
        assert exc_info.value.code == "request_error"

    asyncio.run(scenario())


def test_commands_preserve_shellctl_structured_error_fields() -> None:
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: (_ for _ in ()).throw(
            ShellctlClientError(404, "sandbox_not_found", "sandbox expired")
        )
    )

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        with pytest.raises(ShellProviderError, match="sandbox expired") as exc_info:
            await commands.run("pwd", timeout=2.5)
        assert exc_info.value.status_code == 404
        assert exc_info.value.code == "sandbox_not_found"

    asyncio.run(scenario())


def test_read_bytes_maps_oversize_payload_to_domain_error() -> None:
    payload = base64.b64encode(b'{"path":"reports/large.bin","size":6,"too_large":true}').decode("ascii")
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: _Job(
            job_id="read-job",
            status="exited",
            done=True,
            exit_code=0,
            output=f"{shellctl._WORKSPACE_PAYLOAD_BEGIN}{payload}{shellctl._WORKSPACE_PAYLOAD_END}",
        )
    )

    async def scenario() -> None:
        files = ShellctlFileTransfer(_client_protocol(client))
        with pytest.raises(WorkspaceFileTooLargeError) as exc_info:
            await files.read_bytes(workspace_dir="/workspace", path="reports/large.bin", max_bytes=5)
        assert exc_info.value.size == 6
        assert exc_info.value.max_bytes == 5

    asyncio.run(scenario())


def test_delete_maps_http_timeout_to_shell_provider_error() -> None:
    request = httpx.Request("DELETE", "http://shellctl.example/v1/jobs/run-job")

    @dataclass(slots=True)
    class DeleteTimeoutClient(FakeShellctlClient):
        async def delete(self, job_id, *, force=False, grace_seconds=None):
            self.delete_calls.append((job_id, force, grace_seconds))
            raise httpx.ReadTimeout("delete timed out", request=request)

    client = DeleteTimeoutClient()

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        with pytest.raises(ShellProviderError, match="delete timed out") as exc_info:
            await commands.delete("run-job", force=True, grace_seconds=2.0)
        assert exc_info.value.code == "timeout"

    asyncio.run(scenario())
    assert client.delete_calls == [("run-job", True, 2.0)]


def test_delete_maps_http_request_error_to_shell_provider_error() -> None:
    request = httpx.Request("DELETE", "http://shellctl.example/v1/jobs/run-job")

    @dataclass(slots=True)
    class DeleteRequestErrorClient(FakeShellctlClient):
        async def delete(self, job_id, *, force=False, grace_seconds=None):
            self.delete_calls.append((job_id, force, grace_seconds))
            raise httpx.ConnectError("delete connection failed", request=request)

    client = DeleteRequestErrorClient()

    async def scenario() -> None:
        commands = ShellctlCommands(_client_protocol(client))
        with pytest.raises(ShellProviderError, match="delete connection failed") as exc_info:
            await commands.delete("run-job", force=True, grace_seconds=2.0)
        assert exc_info.value.code == "request_error"

    asyncio.run(scenario())
    assert client.delete_calls == [("run-job", True, 2.0)]


def test_files_upload_and_download_still_work() -> None:
    content = b"hello \x00 world"
    encoded = base64.b64encode(content).decode("ascii")
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: (
            _Job(job_id="ul-job", status="exited", done=True, exit_code=0)
            if "base64 -d" in script
            else _Job(
                job_id="dl-job",
                status="exited",
                done=True,
                exit_code=0,
                output=f"noise{shellctl._TRANSFER_BEGIN}{encoded}{shellctl._TRANSFER_END}tail",
            )
        )
    )

    async def scenario() -> None:
        files = ShellctlFileTransfer(_client_protocol(client))
        await files.upload(content=content, remote_path="out.bin", cwd="~/workspace/abc12ff")
        downloaded = await files.download(remote_path="report.txt", cwd="~/workspace/abc12ff")
        assert downloaded == content

    asyncio.run(scenario())


def test_file_transfer_timeout_is_an_end_to_end_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = {"value": 100.0}

    def fake_monotonic() -> float:
        return clock["value"]

    monkeypatch.setattr(shellctl.time, "monotonic", fake_monotonic)

    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None, timeout: float) -> _Job:
        del script, cwd, env
        assert timeout == pytest.approx(5.0, rel=0, abs=0.01)
        clock["value"] = 103.5
        return _Job(job_id="upload-job", status="running", done=False, output="part-1", offset=6, exit_code=None)

    def wait_handler(job_id: str, offset: int, timeout: float) -> _Job:
        assert job_id == "upload-job"
        assert offset == 6
        assert timeout == pytest.approx(1.5, rel=0, abs=0.01)
        return _Job(job_id=job_id, status="exited", done=True, output="part-2", offset=12, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)

    async def scenario() -> None:
        transfer = shellctl.ShellctlFileTransfer(
            client=_client_protocol(client),
            timeout=5.0,
        )
        await transfer.upload(content=b"payload", remote_path="out.bin")

    asyncio.run(scenario())
    assert client.delete_calls == [("upload-job", True, None)]


def test_file_transfer_timeout_exhaustion_raises_timeout_and_still_deletes_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = {"value": 100.0}

    def fake_monotonic() -> float:
        return clock["value"]

    monkeypatch.setattr(shellctl.time, "monotonic", fake_monotonic)

    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None, timeout: float) -> _Job:
        del script, cwd, env
        assert timeout == pytest.approx(5.0, rel=0, abs=0.01)
        clock["value"] = 106.0
        return _Job(job_id="upload-job", status="running", done=False, output="part-1", offset=6, exit_code=None)

    client = FakeShellctlClient(run_handler=run_handler)

    async def scenario() -> None:
        transfer = shellctl.ShellctlFileTransfer(
            client=_client_protocol(client),
            timeout=5.0,
        )
        with pytest.raises(ShellProviderError, match="timed out") as exc_info:
            await transfer.upload(content=b"payload", remote_path="out.bin")
        assert exc_info.value.code == "timeout"

    asyncio.run(scenario())
    assert client.delete_calls == [("upload-job", True, None)]


def test_download_missing_file_raises() -> None:
    client = FakeShellctlClient(
        run_handler=lambda script, cwd, env, timeout: _Job(
            job_id="dl-job",
            status="exited",
            done=True,
            output="",
            exit_code=shellctl._DOWNLOAD_MISSING_EXIT_CODE,
        )
    )

    async def scenario() -> None:
        files = ShellctlFileTransfer(_client_protocol(client))
        with pytest.raises(ShellFileTransferError, match="not found"):
            await files.download(remote_path="missing.txt")

    asyncio.run(scenario())
