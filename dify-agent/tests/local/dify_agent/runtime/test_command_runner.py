from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field

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


@dataclass(slots=True)
class _PagedCommands(_BlockingCommands):
    done: bool = False
    clock: _Clock | None = None
    blocked_read: bool = False
    reads: int = 0
    interrupts: int = 0
    read_cancelled: bool = False

    async def run(self, script: str, *, cwd, env, timeout: float, mode: ShellExecutionMode = "pty"):
        if self.clock is not None:
            self.clock.now = 10.0
        return ShellCommandResult(
            "job-1", "exited" if self.done else "running", self.done, 0 if self.done else None, "first", 5, True
        )

    async def read_output(self, job_id: str, *, offset: int):
        assert (job_id, offset) == ("job-1", 5)
        self.reads += 1
        if self.blocked_read:
            self.wait_started.set()
            try:
                await self.wait_forever.wait()
            finally:
                self.read_cancelled = True
        return ShellCommandResult("job-1", "exited", True, 0, "-last", 10, False)

    async def interrupt(self, job_id: str, *, grace_seconds: float):
        assert job_id == "job-1"
        self.interrupts += 1
        return ShellCommandStatus(job_id, "interrupted", True, 130, 5)


@pytest.mark.anyio
@pytest.mark.parametrize("done", [False, True])
async def test_expired_deadline_does_not_start_output_replay(monkeypatch, done: bool) -> None:
    clock = _Clock()
    monkeypatch.setattr(command_runner, "time", clock)
    commands = _PagedCommands(done=done, clock=clock)

    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=10.0, max_output_bytes=4096, mode="stdio"
    )

    assert result.incomplete_reason == "timeout"
    assert not result.output_complete
    assert result.output == "first"
    assert commands.reads == 0
    assert commands.interrupts == (0 if done else 1)
    assert commands.deletes == [("job-1", True)]


@pytest.mark.anyio
async def test_output_replay_is_bounded_by_remaining_timeout() -> None:
    commands = _PagedCommands(blocked_read=True)
    result = await asyncio.wait_for(
        execute_complete_with_commands(
            commands, "long-running", cwd="/workspace", env=None, timeout=0.01, max_output_bytes=4096, mode="stdio"
        ),
        timeout=1,
    )

    assert result.incomplete_reason == "timeout"
    assert result.output == "first"
    assert not result.output_complete
    assert commands.reads == 1
    assert commands.read_cancelled
    assert commands.interrupts == 1
    assert commands.deletes == [("job-1", True)]


@pytest.mark.anyio
async def test_output_replay_within_budget_preserves_complete_output() -> None:
    commands = _PagedCommands()
    result = await execute_complete_with_commands(
        commands, "long-running", cwd="/workspace", env=None, timeout=60.0, max_output_bytes=4096, mode="stdio"
    )

    assert result.output == "first-last"
    assert result.output_complete
    assert result.incomplete_reason is None
    assert commands.reads == 1
    assert commands.interrupts == 0
    assert commands.deletes == [("job-1", True)]


@pytest.mark.anyio
async def test_caller_cancellation_during_output_replay_still_propagates() -> None:
    commands = _PagedCommands(blocked_read=True)
    task = asyncio.create_task(
        execute_complete_with_commands(
            commands, "long-running", cwd="/workspace", env=None, timeout=60.0, max_output_bytes=4096, mode="stdio"
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

    assert commands.read_cancelled
    assert commands.interrupts == 0
    assert commands.deletes == [("job-1", True)]
