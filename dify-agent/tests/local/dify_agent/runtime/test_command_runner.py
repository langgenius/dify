from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field, replace

import pytest

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus, ShellExecutionMode
from dify_agent.runtime import command_runner
from dify_agent.runtime.command_runner import execute_complete_with_commands


@dataclass(slots=True)
class _BlockingCommands:
    wait_started: asyncio.Event = field(default_factory=asyncio.Event)
    wait_forever: asyncio.Event = field(default_factory=asyncio.Event)
    deletes: list[tuple[str, bool]] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None,
        env: dict[str, str] | None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ):
        assert script == "long-running"
        assert cwd == "/workspace"
        assert env == {"HOME": "/home/agent"}
        assert timeout > 0
        assert mode == "stdio"
        return ShellCommandResult(
            job_id="job-1",
            status="running",
            done=False,
            exit_code=None,
            output="started",
            offset=7,
            truncated=False,
        )

    async def wait(self, job_id: str, *, offset: int, timeout: float):
        assert (job_id, offset) == ("job-1", 7)
        assert timeout > 0
        self.wait_started.set()
        await self.wait_forever.wait()
        raise AssertionError("wait must remain blocked until cancellation")

    async def read_output(self, job_id: str, *, offset: int):
        raise AssertionError("unexpected read_output")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float):
        raise AssertionError("unexpected input")

    async def interrupt(self, job_id: str, *, grace_seconds: float):
        raise AssertionError("unexpected interrupt")

    async def tail(self, job_id: str):
        raise AssertionError("unexpected tail")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        assert grace_seconds is None
        self.deletes.append((job_id, force))


@pytest.mark.anyio
async def test_cancellation_deletes_job_returned_before_blocking_wait() -> None:
    commands = _BlockingCommands()
    task = asyncio.create_task(
        execute_complete_with_commands(
            commands,  # pyright: ignore[reportArgumentType]
            "long-running",
            cwd="/workspace",
            env={"HOME": "/home/agent"},
            timeout=60.0,
            max_output_bytes=4096,
            mode="stdio",
        )
    )
    try:
        await asyncio.wait_for(commands.wait_started.wait(), timeout=1)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)

    assert commands.deletes == [("job-1", True)]


@dataclass(slots=True)
class _Clock:
    now: float = 0.0

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    clock = _Clock()
    monkeypatch.setattr(command_runner, "time", clock)
    return clock


_FIRST_PAGE = ShellCommandResult("job-1", "running", False, None, "first", 5, True)
_FINAL_PAGE = ShellCommandResult("job-1", "exited", True, 0, "-last", 10, False)


@dataclass(slots=True)
class _PagedCommands:
    clock: _Clock
    run_result: ShellCommandResult = _FIRST_PAGE
    run_elapsed: float = 0.0
    replay_elapsed: float = 0.0
    # A None entry keeps the read pending until cancellation.
    read_results: list[ShellCommandResult | TimeoutError | None] = field(default_factory=list)
    read_started: asyncio.Event = field(default_factory=asyncio.Event)
    read_offsets: list[int] = field(default_factory=list)
    cleanup_calls: list[tuple[str, str] | tuple[str, str, bool]] = field(default_factory=list)
    read_cancelled: bool = False

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        self.clock.now += self.run_elapsed
        return self.run_result

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError("unexpected wait")

    async def read_output(self, job_id: str, *, offset: int) -> ShellCommandResult:
        assert job_id == self.run_result.job_id
        assert self.read_results, "unexpected read_output"
        self.read_offsets.append(offset)
        page = self.read_results.pop(0)
        if isinstance(page, TimeoutError):
            raise page
        if page is not None:
            self.clock.now += self.replay_elapsed
            return page
        self.read_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.read_cancelled = True
            raise
        raise AssertionError("read_output must remain blocked until cancellation")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError("unexpected input")

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> ShellCommandStatus:
        self.cleanup_calls.append(("interrupt", job_id))
        return ShellCommandStatus(job_id, "interrupted", True, 130, 10)

    async def tail(self, job_id: str) -> ShellCommandResult:
        raise AssertionError("unexpected tail")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        assert grace_seconds is None
        self.cleanup_calls.append(("delete", job_id, force))


@pytest.mark.anyio
@pytest.mark.parametrize("done", [False, True], ids=["running", "terminal"])
async def test_expired_deadline_does_not_start_output_replay(clock: _Clock, done: bool) -> None:
    timeout = 10.0
    run_result = replace(_FIRST_PAGE, status="exited", done=True, exit_code=7) if done else _FIRST_PAGE
    commands = _PagedCommands(clock, run_result=run_result, run_elapsed=timeout)

    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=timeout, max_output_bytes=4096, mode="stdio"
    )

    assert result.incomplete_reason == "timeout"
    assert not result.output_complete
    assert result.output == "first"
    assert commands.read_offsets == []
    assert result.done
    if done:
        assert (result.status, result.exit_code) == ("exited", 7)
        assert commands.cleanup_calls == [("delete", "job-1", True)]
    else:
        assert (result.status, result.exit_code) == ("interrupted", 130)
        assert commands.cleanup_calls == [("interrupt", "job-1"), ("delete", "job-1", True)]


@pytest.mark.anyio
async def test_output_replay_is_bounded_by_remaining_timeout(clock: _Clock) -> None:
    timeout = 10.0
    commands = _PagedCommands(
        clock,
        run_elapsed=4.0,
        replay_elapsed=5.98,
        read_results=[ShellCommandResult("job-1", "running", False, None, "-more", 10, True), None],
    )
    result = await asyncio.wait_for(
        execute_complete_with_commands(
            commands, "long-running", cwd="/workspace", env=None, timeout=timeout, max_output_bytes=4096, mode="stdio"
        ),
        timeout=1,
    )

    assert result.incomplete_reason == "timeout"
    assert result.output == "first-more"
    assert not result.output_complete
    assert commands.read_offsets == [5, 10]
    assert commands.read_cancelled
    assert commands.cleanup_calls == [("interrupt", "job-1"), ("delete", "job-1", True)]


@pytest.mark.anyio
async def test_read_output_timeout_error_propagates_before_deadline(clock: _Clock) -> None:
    error = TimeoutError("provider read timed out")
    commands = _PagedCommands(clock, read_results=[error])

    with pytest.raises(TimeoutError) as exc_info:
        await execute_complete_with_commands(
            commands, "long-running", cwd="/workspace", env=None, timeout=10.0, max_output_bytes=4096, mode="stdio"
        )

    assert exc_info.value is error
    assert commands.read_offsets == [5]
    assert commands.cleanup_calls == [("delete", "job-1", True)]


@pytest.mark.anyio
async def test_output_limit_takes_precedence_over_expired_deadline(clock: _Clock) -> None:
    timeout = 10.0
    commands = _PagedCommands(clock, run_elapsed=timeout)

    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=timeout, max_output_bytes=5, mode="stdio"
    )

    assert result.incomplete_reason == "output_limit"
    assert not result.output_complete
    assert result.output == "first"
    assert commands.read_offsets == []


@pytest.mark.anyio
async def test_final_replay_page_takes_precedence_over_expired_deadline(clock: _Clock) -> None:
    timeout = 10.0
    commands = _PagedCommands(clock, replay_elapsed=timeout, read_results=[_FINAL_PAGE])

    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=timeout, max_output_bytes=4096, mode="stdio"
    )

    assert result.output == "first-last"
    assert result.output_complete
    assert result.incomplete_reason is None
    assert commands.read_offsets == [5]
    assert commands.cleanup_calls == [("delete", "job-1", True)]


@pytest.mark.anyio
async def test_output_replay_within_budget_preserves_complete_output(clock: _Clock) -> None:
    commands = _PagedCommands(clock, read_results=[_FINAL_PAGE])
    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=60.0, max_output_bytes=4096, mode="stdio"
    )

    assert result.output == "first-last"
    assert result.output_complete
    assert result.incomplete_reason is None
    assert commands.read_offsets == [5]
    assert commands.cleanup_calls == [("delete", "job-1", True)]


@pytest.mark.anyio
async def test_caller_cancellation_during_output_replay_still_propagates(clock: _Clock) -> None:
    commands = _PagedCommands(clock, read_results=[None])
    task = asyncio.create_task(
        execute_complete_with_commands(
            commands, "long-running", cwd="/workspace", env=None, timeout=60.0, max_output_bytes=4096, mode="stdio"
        )
    )
    try:
        await asyncio.wait_for(commands.read_started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)

    assert commands.read_cancelled
    assert commands.cleanup_calls == [("delete", "job-1", True)]
