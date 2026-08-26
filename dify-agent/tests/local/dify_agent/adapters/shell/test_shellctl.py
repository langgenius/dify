"""Local tests for the shellctl command adapter."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import cast

import httpx2 as httpx
import pytest
from shellctl.client import ShellctlClientError
from shellctl.shared import JobMode

from dify_agent.adapters.shell.protocols import ShellProviderError
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol, ShellctlCommands


@dataclass(slots=True)
class _Job:
    job_id: str = "job-1"
    status: str = "exited"
    done: bool = True
    output: str = "ok"
    offset: int = 2
    truncated: bool = False
    exit_code: int | None = 0
    output_path: str | None = "/tmp/output.log"


@dataclass(slots=True)
class _Status:
    job_id: str = "job-1"
    status: str = "terminated"
    done: bool = True
    offset: int = 2
    exit_code: int | None = 130


@dataclass(slots=True)
class _Client:
    run_result: object = field(default_factory=_Job)
    delete_error: Exception | None = None
    run_calls: list[tuple[str, str | None, dict[str, str] | None, float, JobMode]] = field(default_factory=list)
    wait_calls: list[tuple[str, int, float]] = field(default_factory=list)
    delete_calls: list[tuple[str, bool, float | None]] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd=None,
        env=None,
        timeout=30.0,
        mode: JobMode = JobMode.PTY,
    ):
        self.run_calls.append((script, cwd, env, timeout, mode))
        if isinstance(self.run_result, Exception):
            raise self.run_result
        return self.run_result

    async def wait(self, job_id: str, *, offset: int, timeout=30.0):
        self.wait_calls.append((job_id, offset, timeout))
        return _Job(job_id=job_id)

    async def input(self, job_id: str, text: str, *, offset: int, timeout=30.0):
        return _Job(job_id=job_id)

    async def tail(self, job_id: str):
        return _Job(job_id=job_id)

    async def terminate(self, job_id: str, grace_seconds=10.0):
        return _Status(job_id=job_id)

    async def delete(self, job_id: str, *, force=False, grace_seconds=None):
        self.delete_calls.append((job_id, force, grace_seconds))
        if self.delete_error is not None:
            raise self.delete_error
        return object()

    async def close(self) -> None:
        return None


def _client(client: _Client) -> ShellctlClientProtocol:
    return cast(ShellctlClientProtocol, cast(object, client))


def test_commands_apply_runtime_layout_and_home_environment() -> None:
    client = _Client()

    async def scenario() -> None:
        commands = ShellctlCommands(_client(client), home_dir="/home/binding", workspace_dir="/workspace")
        result = await commands.run("pwd", cwd="reports", env={"TOKEN": "value"}, timeout=2.5)
        assert result.output == "ok"

    asyncio.run(scenario())
    assert client.run_calls == [
        ("pwd", "/workspace/reports", {"TOKEN": "value", "HOME": "/home/binding"}, 2.5, JobMode.PTY)
    ]


def test_commands_forward_stdio_mode() -> None:
    client = _Client()

    async def scenario() -> None:
        commands = ShellctlCommands(_client(client))
        await commands.run("printf result", timeout=2.5, mode="stdio")

    asyncio.run(scenario())
    assert client.run_calls == [("printf result", None, None, 2.5, JobMode.STDIO)]


def test_commands_reject_cwd_outside_runtime_layout() -> None:
    async def scenario() -> None:
        commands = ShellctlCommands(_client(_Client()), home_dir="/home/binding", workspace_dir="/workspace")
        with pytest.raises(ValueError, match="outside this RuntimeLease"):
            await commands.run("pwd", cwd="/var/private", timeout=2.5)

    asyncio.run(scenario())


def test_read_output_uses_nonblocking_wait() -> None:
    client = _Client()

    async def scenario() -> None:
        commands = ShellctlCommands(_client(client))
        result = await commands.read_output("job-1", offset=7)
        assert result.job_id == "job-1"

    asyncio.run(scenario())
    assert client.wait_calls == [("job-1", 7, 0.0)]


def test_commands_map_http_and_structured_errors() -> None:
    request = httpx.Request("POST", "http://shellctl.example/v1/jobs")

    async def scenario() -> None:
        timeout_commands = ShellctlCommands(
            _client(_Client(run_result=httpx.ReadTimeout("timed out", request=request)))
        )
        with pytest.raises(ShellProviderError) as timeout_error:
            await timeout_commands.run("pwd", timeout=2.5)
        assert timeout_error.value.code == "timeout"

        missing_commands = ShellctlCommands(
            _client(_Client(run_result=ShellctlClientError(404, "sandbox_not_found", "expired")))
        )
        with pytest.raises(ShellProviderError) as missing_error:
            await missing_commands.run("pwd", timeout=2.5)
        assert missing_error.value.code == "sandbox_not_found"
        assert missing_error.value.status_code == 404

    asyncio.run(scenario())


def test_delete_treats_missing_job_as_already_deleted() -> None:
    client = _Client(delete_error=ShellctlClientError(404, "job_not_found", "missing"))

    async def scenario() -> None:
        commands = ShellctlCommands(_client(client))
        await commands.delete("job-1", force=True)

    asyncio.run(scenario())
    assert client.delete_calls == [("job-1", True, None)]
