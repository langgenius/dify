from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import cast

import pytest

import dify_agent.runtime_backend.shellctl as shellctl_backend_module
from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.protocols import RuntimeLayout
from dify_agent.runtime_backend.shellctl import (
    CONTROL_COMMAND_OUTPUT_LIMIT,
    create_owned_shellctl_lease,
    create_shellctl_lease,
    execute_complete_with_commands,
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
    wait_results: list[ShellCommandResult] = field(default_factory=list)
    wait_error: BaseException | None = None
    delete_error: Exception | None = None
    delete_calls: list[tuple[str, bool]] = field(default_factory=list)
    run_timeouts: list[float] = field(default_factory=list)
    wait_timeouts: list[float] = field(default_factory=list)
    wait_started: asyncio.Event | None = None
    wait_release: asyncio.Event | None = None

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        del script, cwd, env
        self.run_timeouts.append(timeout)
        return self.initial

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        del job_id, offset
        self.wait_timeouts.append(timeout)
        if self.wait_started is not None:
            self.wait_started.set()
            assert self.wait_release is not None
            await asyncio.wait_for(self.wait_release.wait(), timeout=1.0)
        if self.wait_error is not None:
            raise self.wait_error
        if self.wait_results:
            return self.wait_results.pop(0)
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
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
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
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
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
            layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
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
        result = await execute_complete_with_commands(
            commands,
            "true",
            cwd=None,
            env=None,
            timeout=30.0,
            max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
        )

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
            _ = await execute_complete_with_commands(
                commands,
                "false",
                cwd=None,
                env=None,
                timeout=30.0,
                max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
            )

    assert commands.delete_calls == [("job-1", True)]
    assert "delete failed" in caplog.text


@pytest.mark.anyio
async def test_control_command_wait_cancellation_is_propagated_and_job_is_deleted() -> None:
    wait_started = asyncio.Event()
    wait_release = asyncio.Event()
    commands = _FakeCommands(
        initial=_result(done=False),
        wait_started=wait_started,
        wait_release=wait_release,
    )

    task = asyncio.create_task(
        execute_complete_with_commands(
            commands,
            "cancelled-control-job",
            cwd=None,
            env=None,
            timeout=30.0,
            max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
        )
    )
    try:
        await asyncio.wait_for(wait_started.wait(), timeout=1.0)
        task.cancel()
        done, _ = await asyncio.wait({task}, timeout=1.0)
        assert task in done, "control command ignored cancellation"
        with pytest.raises(asyncio.CancelledError):
            _ = task.result()
    finally:
        wait_release.set()
        task.cancel()
        done, _ = await asyncio.wait({task}, timeout=1.0)
        if task not in done:
            pytest.fail("control command task did not finish during bounded cleanup")
        if not task.cancelled():
            _ = task.exception()

    assert commands.delete_calls == [("job-1", True)]


@pytest.mark.anyio
async def test_complete_executor_without_deadline_repeats_fixed_long_polls() -> None:
    commands = _FakeCommands(
        initial=_result(done=False),
        wait_results=[_result(done=False), _result(done=True)],
    )

    result = await execute_complete_with_commands(
        commands,
        "long-running-control-job",
        cwd="/home/dify",
        env={"TOKEN": "opaque"},
        timeout=None,
        max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
    )

    assert result.done is True
    assert result.output == "okokok"
    assert commands.run_timeouts == [30.0]
    assert commands.wait_timeouts == [30.0, 30.0]
    assert commands.delete_calls == [("job-1", True)]


@pytest.mark.anyio
async def test_complete_executor_with_deadline_preserves_full_remaining_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0

    def monotonic() -> float:
        return now

    monkeypatch.setattr(shellctl_backend_module.time, "monotonic", monotonic)
    commands = _FakeCommands(initial=_result(done=True))

    _ = await execute_complete_with_commands(
        commands,
        "bounded-job",
        cwd=None,
        env=None,
        timeout=60.0,
        max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
    )

    assert commands.run_timeouts == [60.0]
