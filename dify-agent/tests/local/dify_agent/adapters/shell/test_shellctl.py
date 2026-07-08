"""Local tests for the shellctl shell adapter and env-driven provider factory."""

from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
import pytest
from pydantic import ValidationError

from dify_agent.adapters.shell import shellctl
from dify_agent.adapters.shell.config import ShellAdapterSettings
from dify_agent.adapters.shell.factory import create_shell_provider
from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellProviderError
from dify_agent.adapters.shell.shellctl import ShellFileTransferError, ShellctlProvider


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

    async def run(self, script, *, cwd=None, env=None, timeout=30.0):
        self.run_calls.append(_RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        if self.run_handler is not None:
            return self.run_handler(script, cwd, env, timeout)
        return _Job(job_id="job", status="exited", done=True, exit_code=0)

    async def wait(self, job_id, *, offset, timeout=30.0):
        self.wait_calls.append((job_id, offset, timeout))
        if self.wait_handler is not None:
            return self.wait_handler(job_id, offset, timeout)
        return _Job(job_id=job_id, status="exited", done=True, offset=offset, exit_code=0)

    async def input(self, job_id, text, *, offset, timeout=30.0):
        self.input_calls.append((job_id, text, offset, timeout))
        if self.input_handler is not None:
            return self.input_handler(job_id, text, offset, timeout)
        return _Job(job_id=job_id, status="exited", done=True, offset=offset, exit_code=0)

    async def tail(self, job_id):
        if self.tail_handler is not None:
            return self.tail_handler(job_id)
        return _Job(job_id=job_id, status="exited", done=True, output="", exit_code=0)

    async def terminate(self, job_id, grace_seconds=10.0):
        self.terminate_calls.append((job_id, grace_seconds))
        if self.terminate_handler is not None:
            return self.terminate_handler(job_id, grace_seconds)
        return _Status(job_id=job_id)

    async def delete(self, job_id, *, force=False, grace_seconds=None):
        self.delete_calls.append((job_id, force, grace_seconds))
        return None

    async def close(self):
        self.closed = True


def _provider(client: FakeShellctlClient) -> ShellctlProvider:
    return ShellctlProvider(entrypoint="http://shellctl", token="", client_factory=lambda: client)


def test_factory_unknown_provider_raises() -> None:
    with pytest.raises(ValidationError):
        ShellAdapterSettings(shell_provider="nope")  # type: ignore[arg-type]


def test_factory_shellctl_requires_entrypoint() -> None:
    with pytest.raises(ValidationError, match="shellctl_entrypoint is required"):
        ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint=None)


def test_factory_builds_shellctl_provider_from_settings() -> None:
    settings = ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint="http://shellctl.example")
    provider = create_shell_provider(settings)
    assert isinstance(provider, ShellctlProvider)
    assert provider.entrypoint == "http://shellctl.example"
    assert provider.token == ""


def test_provider_create_opens_only_live_resource_and_suspend_closes_client() -> None:
    client = FakeShellctlClient()

    async def scenario() -> None:
        resource = await _provider(client).create()
        assert client.run_calls == []
        await resource.suspend()

    asyncio.run(scenario())
    assert client.closed is True


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
        resource = await _provider(client).create()
        run_result = await resource.commands.run("pwd", cwd="~/workspace/abc12ff", env={"FOO": "bar"}, timeout=2.5)
        wait_result = await resource.commands.wait("run-job", offset=3, timeout=4.0)
        read_result = await resource.commands.read_output("run-job", offset=6)
        input_result = await resource.commands.input("run-job", "ls\n", offset=6, timeout=5.0)
        interrupt_result = await resource.commands.interrupt("run-job", grace_seconds=1.5)
        tail_result = await resource.commands.tail("run-job")
        await resource.commands.delete("run-job", force=True, grace_seconds=2.0)
        await resource.suspend()

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
        resource = await _provider(client).create()
        with pytest.raises(ShellProviderError, match="timed out") as exc_info:
            await resource.commands.run("pwd", timeout=2.5)
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
        resource = await _provider(client).create()
        with pytest.raises(ShellProviderError, match="connection failed") as exc_info:
            await resource.commands.wait("run-job", offset=3, timeout=4.0)
        assert exc_info.value.code == "request_error"

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
        resource = await _provider(client).create()
        with pytest.raises(ShellProviderError, match="delete timed out") as exc_info:
            await resource.commands.delete("run-job", force=True, grace_seconds=2.0)
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
        resource = await _provider(client).create()
        with pytest.raises(ShellProviderError, match="delete connection failed") as exc_info:
            await resource.commands.delete("run-job", force=True, grace_seconds=2.0)
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
        resource = await _provider(client).create()
        await resource.files.upload(content=content, remote_path="out.bin", cwd="~/workspace/abc12ff")
        downloaded = await resource.files.download(remote_path="report.txt", cwd="~/workspace/abc12ff")
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
        transfer = shellctl.ShellctlFileTransfer(client=client, timeout=5.0)
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
        transfer = shellctl.ShellctlFileTransfer(client=client, timeout=5.0)
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
        resource = await _provider(client).create()
        with pytest.raises(ShellFileTransferError, match="not found"):
            await resource.files.download(remote_path="missing.txt")

    asyncio.run(scenario())
