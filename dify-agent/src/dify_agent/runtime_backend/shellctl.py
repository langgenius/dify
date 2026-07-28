"""Shared shellctl RuntimeLease used by every runtime backend."""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import time
from typing import Literal, Protocol

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
)
from dify_agent.adapters.shell.shellctl import (
    ShellctlClientFactory,
    ShellctlClientProtocol,
    ShellctlCommands,
    ShellctlFileTransfer,
    create_default_shellctl_client_factory,
)
from dify_agent.runtime_backend.protocols import FileSystem, RuntimeLayout

_COMPLETE_POLL_TIMEOUT_SECONDS = 30.0
_COMPLETE_TERMINATE_GRACE_SECONDS = 10.0
CONTROL_COMMAND_OUTPUT_LIMIT = 256 * 1024
logger = logging.getLogger(__name__)


class AsyncCloseable(Protocol):
    async def aclose(self) -> None: ...


@dataclass(slots=True)
class ShellctlRuntimeLease:
    """One invocation-local shellctl connection and its canonical layout."""

    handle: str
    layout: RuntimeLayout
    client: ShellctlClientProtocol
    commands: ShellCommandProtocol
    files: FileSystem
    owned_transport: AsyncCloseable | None = None
    _closed: bool = field(default=False, init=False)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        client_error: BaseException | None = None
        try:
            await self.client.close()
        except BaseException as exc:
            client_error = exc
        try:
            if self.owned_transport is not None:
                await self.owned_transport.aclose()
        except BaseException as exc:
            if client_error is None:
                raise
            logger.warning("Failed to close owned shellctl transport after client close failed: %s", exc)
        if client_error is not None:
            raise client_error


def create_shellctl_lease(
    *,
    handle: str,
    layout: RuntimeLayout,
    entrypoint: str,
    token: str,
    client_factory: ShellctlClientFactory | None = None,
    owned_transport: AsyncCloseable | None = None,
) -> ShellctlRuntimeLease:
    """Create adapters around one new shellctl client without owning control-plane lifecycle."""
    factory = client_factory or create_default_shellctl_client_factory(entrypoint=entrypoint, token=token)
    client = factory()
    return ShellctlRuntimeLease(
        handle=handle,
        layout=layout,
        client=client,
        commands=ShellctlCommands(
            client=client,
            home_dir=layout.home_dir,
            workspace_dir=layout.workspace_dir,
        ),
        files=ShellctlFileTransfer(
            client=client,
            cwd=layout.workspace_dir,
            home_dir=layout.home_dir,
        ),
        owned_transport=owned_transport,
    )


async def create_owned_shellctl_lease(
    *,
    handle: str,
    layout: RuntimeLayout,
    entrypoint: str,
    token: str,
    client_factory: ShellctlClientFactory,
    owned_transport: AsyncCloseable,
) -> ShellctlRuntimeLease:
    """Create a lease that owns an injected transport, closing it if construction fails."""
    try:
        return create_shellctl_lease(
            handle=handle,
            layout=layout,
            entrypoint=entrypoint,
            token=token,
            client_factory=client_factory,
            owned_transport=owned_transport,
        )
    except BaseException:
        try:
            await owned_transport.aclose()
        except BaseException as cleanup_exc:
            logger.warning("Failed to close owned shellctl transport after lease construction failed: %s", cleanup_exc)
        raise


async def execute_complete_with_commands(
    commands: ShellCommandProtocol,
    script: str,
    *,
    cwd: str | None,
    env: dict[str, str] | None,
    timeout: float | None,
    max_output_bytes: int,
) -> CompleteShellCommandResult:
    """Run one command to completion and always delete its transient shellctl job.

    ``timeout=None`` deliberately imposes no total execution deadline. Each
    shellctl call still long-polls for at most 30 seconds so cancellation and
    terminal state are observed without turning a poll timeout into a job
    timeout.
    """
    deadline = None if timeout is None else time.monotonic() + timeout
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
            timeout=_poll_timeout(deadline),
        )
        job_id = result.job_id
        while True:
            remaining_bytes = max(max_output_bytes - captured_bytes, 0)
            limited_output = _utf8_prefix(result.output, remaining_bytes)
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
            if deadline is not None and time.monotonic() >= deadline:
                incomplete_reason = "timeout"
                break
            result = await commands.wait(
                result.job_id,
                offset=result.offset,
                timeout=_poll_timeout(deadline),
            )

        final_status = result.status
        final_done = result.done
        final_exit_code = result.exit_code
        final_offset = result.offset
        if incomplete_reason is not None and not result.done:
            terminal = await commands.interrupt(
                result.job_id,
                grace_seconds=_COMPLETE_TERMINATE_GRACE_SECONDS,
            )
            final_status = terminal.status
            final_done = terminal.done
            final_exit_code = terminal.exit_code
            final_offset = terminal.offset
        return CompleteShellCommandResult(
            job_id=result.job_id,
            status=final_status,
            done=final_done,
            exit_code=final_exit_code,
            output="".join(output_parts),
            output_complete=incomplete_reason is None,
            incomplete_reason=incomplete_reason,
            offset=final_offset,
            output_path=result.output_path,
        )
    finally:
        if job_id is not None:
            try:
                await commands.delete(job_id, force=True)
            except Exception as exc:
                logger.warning("Failed to delete transient shellctl job %s: %s", job_id, exc)


def _poll_timeout(deadline: float | None) -> float:
    if deadline is None:
        return _COMPLETE_POLL_TIMEOUT_SECONDS
    return max(deadline - time.monotonic(), 0.0)


def _utf8_prefix(value: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


__all__ = [
    "AsyncCloseable",
    "CONTROL_COMMAND_OUTPUT_LIMIT",
    "ShellctlRuntimeLease",
    "create_owned_shellctl_lease",
    "create_shellctl_lease",
    "execute_complete_with_commands",
]
