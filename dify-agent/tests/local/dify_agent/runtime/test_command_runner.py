from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field

import pytest

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellExecutionMode
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
