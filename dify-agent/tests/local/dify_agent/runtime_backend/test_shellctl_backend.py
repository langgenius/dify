from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.protocols import SandboxLayout
from dify_agent.runtime_backend.shellctl import (
    create_owned_shellctl_lease,
    create_shellctl_lease,
    run_shellctl_control_command,
)


@dataclass(slots=True)
class _FakeClient:
    close_error: Exception | None = None
    close_calls: int = 0

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _FakeTransport:
    close_error: Exception | None = None
    close_calls: int = 0

    async def aclose(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _FakeCommands:
    initial: ShellCommandResult
    wait_error: Exception | None = None
    delete_error: Exception | None = None
    delete_calls: list[tuple[str, bool]] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        del script, cwd, env, timeout
        return self.initial

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        del job_id, offset, timeout
        if self.wait_error is not None:
            raise self.wait_error
        raise AssertionError("wait was not expected")

    async def read_output(self, job_id: str, *, offset: int) -> ShellCommandResult:
        raise AssertionError((job_id, offset))

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError((job_id, text, offset, timeout))

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> ShellCommandStatus:
        raise AssertionError((job_id, grace_seconds))

    async def tail(self, job_id: str) -> ShellCommandResult:
        raise AssertionError(job_id)

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None:
        del grace_seconds
        self.delete_calls.append((job_id, force))
        if self.delete_error is not None:
            raise self.delete_error


def _result(*, done: bool = True) -> ShellCommandResult:
    return ShellCommandResult(
        job_id="job-1",
        status="exited" if done else "running",
        done=done,
        exit_code=0 if done else None,
        output="ok",
        offset=2,
        truncated=False,
    )


@pytest.mark.anyio
async def test_owned_transport_is_closed_exactly_once() -> None:
    client = _FakeClient()
    transport = _FakeTransport()
    lease = create_shellctl_lease(
        handle="sandbox-1",
        layout=SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
        entrypoint="http://shellctl",
        token="secret",
        client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
        owned_transport=transport,
    )

    await lease.close()
    await lease.close()

    assert client.close_calls == 1
    assert transport.close_calls == 1


@pytest.mark.anyio
async def test_owned_transport_closes_when_client_close_fails_without_double_close() -> None:
    client = _FakeClient(close_error=RuntimeError("client close failed"))
    transport = _FakeTransport()
    lease = create_shellctl_lease(
        handle="sandbox-1",
        layout=SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
        entrypoint="http://shellctl",
        token="secret",
        client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
        owned_transport=transport,
    )

    with pytest.raises(RuntimeError, match="client close failed"):
        await lease.close()
    await lease.close()

    assert client.close_calls == 1
    assert transport.close_calls == 1


@pytest.mark.anyio
async def test_owned_transport_closes_when_client_construction_fails() -> None:
    transport = _FakeTransport()

    def fail_factory() -> ShellctlClientProtocol:
        raise RuntimeError("client construction failed")

    with pytest.raises(RuntimeError, match="client construction failed"):
        _ = await create_owned_shellctl_lease(
            handle="sandbox-1",
            layout=SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
            entrypoint="http://shellctl",
            token="secret",
            client_factory=fail_factory,
            owned_transport=transport,
        )

    assert transport.close_calls == 1


@pytest.mark.anyio
async def test_control_command_success_is_preserved_when_delete_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    commands = _FakeCommands(initial=_result(), delete_error=RuntimeError("delete failed"))

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.shellctl"):
        result = await run_shellctl_control_command(commands, "true")

    assert result.output == "ok"
    assert commands.delete_calls == [("job-1", True)]
    assert "delete failed" in caplog.text


@pytest.mark.anyio
async def test_control_command_error_is_preserved_when_delete_also_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    commands = _FakeCommands(
        initial=_result(done=False),
        wait_error=RuntimeError("command failed"),
        delete_error=RuntimeError("delete failed"),
    )

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.shellctl"):
        with pytest.raises(RuntimeError, match="command failed"):
            _ = await run_shellctl_control_command(commands, "false")

    assert commands.delete_calls == [("job-1", True)]
    assert "delete failed" in caplog.text
