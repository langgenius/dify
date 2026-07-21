"""Shared shellctl data-plane lease used by every runtime backend."""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
from typing import Protocol

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult, ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import (
    ShellctlClientFactory,
    ShellctlClientProtocol,
    ShellctlCommands,
    ShellctlFileTransfer,
    create_default_shellctl_client_factory,
)
from dify_agent.runtime_backend.protocols import FileSystem, SandboxLayout

_CONTROL_COMMAND_OUTPUT_LIMIT = 256 * 1024
logger = logging.getLogger(__name__)


class AsyncCloseable(Protocol):
    async def aclose(self) -> None: ...


@dataclass(slots=True)
class ShellctlSandboxLease:
    """One live shellctl connection plus backend-neutral sandbox identity/layout."""

    handle: str
    layout: SandboxLayout
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
    layout: SandboxLayout,
    entrypoint: str,
    token: str,
    client_factory: ShellctlClientFactory | None = None,
    owned_transport: AsyncCloseable | None = None,
) -> ShellctlSandboxLease:
    """Create adapters around one new shellctl client without owning control-plane lifecycle."""
    factory = client_factory or create_default_shellctl_client_factory(entrypoint=entrypoint, token=token)
    client = factory()
    return ShellctlSandboxLease(
        handle=handle,
        layout=layout,
        client=client,
        commands=ShellctlCommands(client=client),
        files=ShellctlFileTransfer(client=client),
        owned_transport=owned_transport,
    )


async def create_owned_shellctl_lease(
    *,
    handle: str,
    layout: SandboxLayout,
    entrypoint: str,
    token: str,
    client_factory: ShellctlClientFactory,
    owned_transport: AsyncCloseable,
) -> ShellctlSandboxLease:
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
    """Run one bounded driver control command and always delete its transient job."""
    result = await commands.run(script, cwd=None, env=None, timeout=timeout)
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


__all__ = [
    "AsyncCloseable",
    "ShellctlSandboxLease",
    "create_owned_shellctl_lease",
    "create_shellctl_lease",
    "run_shellctl_control_command",
]
