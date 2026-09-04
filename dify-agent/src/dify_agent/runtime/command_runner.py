"""Bounded execution of one transient command through a RuntimeLease."""

from __future__ import annotations

import logging
import time
from typing import Literal

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
    ShellExecutionMode,
)
from dify_agent.layers.shell.output_text import utf8_prefix

logger = logging.getLogger(__name__)

_TERMINATE_GRACE_SECONDS = 10.0


async def execute_complete_with_commands(
    commands: ShellCommandProtocol,
    script: str,
    *,
    cwd: str | None,
    env: dict[str, str] | None,
    timeout: float,
    max_output_bytes: int,
    mode: ShellExecutionMode,
) -> CompleteShellCommandResult:
    """Run a command to completion with bounded output and deterministic cleanup."""

    deadline = time.monotonic() + timeout
    job_id: str | None = None
    result: ShellCommandResult | None = None
    output_parts: list[str] = []
    captured_bytes = 0
    incomplete_reason: Literal["output_limit", "timeout"] | None = None
    try:
        result = await commands.run(
            script,
            cwd=cwd,
            env=env,
            timeout=_remaining_time(deadline),
            mode=mode,
        )
        job_id = result.job_id
        while True:
            remaining_bytes = max(max_output_bytes - captured_bytes, 0)
            limited_output = utf8_prefix(result.output, remaining_bytes)
            output_parts.append(limited_output)
            captured_bytes += len(limited_output.encode("utf-8"))
            if limited_output != result.output:
                incomplete_reason = "output_limit"
                break
            if captured_bytes >= max_output_bytes and (result.truncated or not result.done):
                incomplete_reason = "output_limit"
                break
            if result.truncated:
                result = await commands.read_output(result.job_id, offset=result.offset)
                continue
            if result.done:
                break
            remaining_time = _remaining_time(deadline)
            if remaining_time <= 0.0:
                incomplete_reason = "timeout"
                break
            result = await commands.wait(result.job_id, offset=result.offset, timeout=remaining_time)

        final_status = result.status
        final_done = result.done
        final_exit_code = result.exit_code
        final_offset = result.offset
        final_output_path = result.output_path
        if incomplete_reason is not None and not result.done:
            terminal_status = await commands.interrupt(result.job_id, grace_seconds=_TERMINATE_GRACE_SECONDS)
            final_status = terminal_status.status
            final_done = terminal_status.done
            final_exit_code = terminal_status.exit_code
            final_offset = terminal_status.offset
        return CompleteShellCommandResult(
            job_id=result.job_id,
            status=final_status,
            done=final_done,
            exit_code=final_exit_code,
            output="".join(output_parts),
            output_complete=incomplete_reason is None,
            incomplete_reason=incomplete_reason,
            offset=final_offset,
            output_path=final_output_path,
        )
    finally:
        if job_id is not None:
            try:
                await commands.delete(job_id, force=True)
            except RuntimeError as exc:
                logger.warning("Failed to delete transient shell job %s: %s", job_id, exc)


def _remaining_time(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())


__all__ = ["execute_complete_with_commands"]
