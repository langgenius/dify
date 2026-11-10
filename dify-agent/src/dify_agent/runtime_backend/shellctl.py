"""Shared shellctl RuntimeLease used by every runtime backend."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
import logging
from typing import Literal, Protocol

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult, ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import (
    ShellctlClientFactory,
    ShellctlClientProtocol,
    ShellctlCommands,
    create_default_shellctl_client_factory,
)
from dify_agent.runtime_backend.protocols import RuntimeLayout

_CONTROL_COMMAND_OUTPUT_LIMIT = 256 * 1024
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

    async def close_for_inspection(self, *, deadline: float) -> bool:
        """Close owned resources within the inspection's absolute cleanup deadline.

        Preconditions: running asyncio loop and an owner-selected deadline.
        Postconditions: each close is attempted at most once, a stalled client
        cannot consume an owned transport's budget, and diagnostics contain only
        fixed phase/category/status fields. Failure is reported, never retried.
        """
        if self._closed:
            return True
        self._closed = True
        loop = asyncio.get_running_loop()
        client_deadline = (loop.time() + deadline) / 2 if self.owned_transport is not None else deadline
        client_closed = await _inspection_cleanup(self.client.close, phase="close_client", deadline=client_deadline)
        transport_closed = True
        if self.owned_transport is not None:
            transport_closed = await _inspection_cleanup(
                self.owned_transport.aclose, phase="close_transport", deadline=deadline
            )
        return client_closed and transport_closed


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


async def run_shellctl_control_command(
    commands: ShellCommandProtocol,
    script: str,
    *,
    timeout: float = 30.0,
) -> CompleteShellCommandResult:
    """Run one bounded control command through stdout-only stdio and delete its transient job."""
    result = await commands.run(script, cwd=None, env=None, timeout=timeout, mode="stdio")
    job_id = result.job_id
    output_parts = [result.output]
    try:
        while result.truncated or not result.done:
            result = await commands.wait(result.job_id, offset=result.offset, timeout=timeout)
            output_parts.append(result.output)
            if sum(len(part.encode("utf-8")) for part in output_parts) > _CONTROL_COMMAND_OUTPUT_LIMIT:
                raise RuntimeError("shellctl control command exceeded its output limit")
        return CompleteShellCommandResult(
            job_id=result.job_id,
            status=result.status,
            done=result.done,
            exit_code=result.exit_code,
            output="".join(output_parts),
            output_complete=True,
            incomplete_reason=None,
            offset=result.offset,
            output_path=result.output_path,
        )
    finally:
        try:
            await commands.delete(job_id, force=True)
        except Exception as exc:
            logger.warning("Failed to delete transient shellctl control job %s: %s", job_id, exc)


async def _inspection_cleanup(
    operation: Callable[[], Awaitable[object]],
    *,
    phase: Literal["delete", "close_client", "close_transport"],
    deadline: float,
) -> bool:
    """Await one inspection cleanup within its budget; never log resource/error values."""
    category: Literal["timeout", "error"]
    try:
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError
        async with asyncio.timeout_at(deadline):
            await operation()
        return True
    except TimeoutError:
        category = "timeout"
    except Exception:
        category = "error"
    logger.warning(
        "binding inspection cleanup unavailable",
        extra={"inspection_phase": phase, "inspection_category": category, "inspection_status": "uncertain"},
    )
    return False


async def run_shellctl_inspection_command(
    lease: ShellctlRuntimeLease,
    script: str,
    *,
    deadline: float,
    cleanup_budget: float,
) -> CompleteShellCommandResult:
    """Run one fixed read-only inspection under a single absolute deadline.

    Preconditions: an inspection-owned lease, positive cleanup reservation and
    deadline measured before lease construction. Postconditions: no new binding
    action; run/polls share the remaining probe budget, known-job deletion and
    lease close share a bounded reserved cleanup budget. Cleanup timeout/error
    invalidates the observation. External cancellation remains cancellation;
    successful cleanup never proves remote process termination after a timeout.
    """
    loop = asyncio.get_running_loop()
    if cleanup_budget <= 0:
        raise ValueError("inspection requires positive cleanup budget")
    probe_deadline = deadline - cleanup_budget
    job_id: str | None = None
    cleanup_ok = False
    try:
        if loop.time() >= probe_deadline:
            raise TimeoutError
        async with asyncio.timeout_at(probe_deadline):
            result = await lease.commands.run(
                script, cwd=None, env=None, timeout=probe_deadline - loop.time(), mode="stdio"
            )
            job_id = result.job_id
            output_parts = [result.output]
            output_size = len(result.output.encode("utf-8"))
            while result.truncated or not result.done:
                if loop.time() >= probe_deadline:
                    raise TimeoutError
                result = await lease.commands.wait(job_id, offset=result.offset, timeout=probe_deadline - loop.time())
                output_parts.append(result.output)
                output_size += len(result.output.encode("utf-8"))
                if output_size > _CONTROL_COMMAND_OUTPUT_LIMIT:
                    raise ValueError("inspection output limit")
            if output_size > _CONTROL_COMMAND_OUTPUT_LIMIT:
                raise ValueError("inspection output limit")
            complete = CompleteShellCommandResult(
                job_id=job_id,
                status=result.status,
                done=result.done,
                exit_code=result.exit_code,
                output="".join(output_parts),
                output_complete=True,
                incomplete_reason=None,
                offset=result.offset,
                output_path=result.output_path,
            )
    finally:
        cleanup_deadline = min(deadline, loop.time() + cleanup_budget)
        deleted = True
        if job_id is not None:
            delete_deadline = min(cleanup_deadline, loop.time() + cleanup_budget / 2)
            selected_job_id = job_id
            deleted = await _inspection_cleanup(
                lambda: lease.commands.delete(selected_job_id, force=True), phase="delete", deadline=delete_deadline
            )
        closed = await lease.close_for_inspection(deadline=cleanup_deadline)
        cleanup_ok = deleted and closed
    if not cleanup_ok:
        raise RuntimeError("inspection cleanup unavailable")
    return complete


__all__ = [
    "AsyncCloseable",
    "ShellctlRuntimeLease",
    "create_owned_shellctl_lease",
    "create_shellctl_lease",
    "run_shellctl_control_command",
    "run_shellctl_inspection_command",
]
