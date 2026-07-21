"""Local runtime backend using one shared shellctl daemon and filesystem scopes.

The daemon is process infrastructure, not a sandbox identity. Stable handles are
runtime session IDs, each mapped to its own canonical Home and Workspace paths.
"""

from __future__ import annotations

import logging
import re
import shlex
from dataclasses import dataclass
from pathlib import PurePosixPath

from dify_agent.adapters.shell.shellctl import ShellctlClientFactory
from dify_agent.runtime_backend.errors import (
    HomeSnapshotCreateError,
    SandboxCleanupError,
    SandboxCreateError,
    SandboxLostError,
    SandboxResumeError,
)
from dify_agent.runtime_backend.protocols import (
    CreateHomeSnapshotRequest,
    SandboxCreateSpec,
    SandboxLayout,
    SandboxLease,
)
from dify_agent.runtime_backend.shellctl import (
    ShellctlSandboxLease,
    create_shellctl_lease,
    run_shellctl_control_command,
)

_SAFE_HANDLE = re.compile(r"^[A-Za-z0-9._-]+$")
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LocalHomeSnapshotDriver:
    """Store immutable Home Snapshot files below a shellctl-visible local root."""

    endpoint: str
    auth_token: str
    snapshot_root: str = "/home/dify/.dify-agent-home-snapshots"
    client_factory: ShellctlClientFactory | None = None

    async def create(self, request: CreateHomeSnapshotRequest) -> str:
        snapshot_ref = _local_snapshot_ref(request.source_digest)
        layout = SandboxLayout(home_dir=self.snapshot_root, workspace_dir=self.snapshot_root)
        lease = create_shellctl_lease(
            handle=snapshot_ref,
            layout=layout,
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )
        target = f"{self.snapshot_root.rstrip('/')}/{snapshot_ref}"
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"set -eu\nmkdir -p {shlex.quote(target)}\nchmod 700 {shlex.quote(target)}",
            )
            if result.exit_code != 0:
                raise HomeSnapshotCreateError(result.output)
            for source_file in request.source.files:
                relative_path = _validated_relative_path(source_file.path)
                await lease.files.upload(
                    content=source_file.content,
                    remote_path=f"{target}/{relative_path}",
                )
            return snapshot_ref
        except HomeSnapshotCreateError:
            raise
        except Exception as exc:
            raise HomeSnapshotCreateError(str(exc)) from exc
        finally:
            await lease.close()

    async def delete(self, snapshot_ref: str) -> None:
        _validated_handle(snapshot_ref)
        layout = SandboxLayout(home_dir=self.snapshot_root, workspace_dir=self.snapshot_root)
        lease = create_shellctl_lease(
            handle=snapshot_ref,
            layout=layout,
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )
        try:
            target = f"{self.snapshot_root.rstrip('/')}/{snapshot_ref}"
            result = await run_shellctl_control_command(lease.commands, f"rm -rf -- {shlex.quote(target)}")
            if result.exit_code != 0:
                raise SandboxCleanupError(result.output)
        finally:
            await lease.close()


@dataclass(slots=True)
class LocalSandboxDriver:
    """Map one runtime session to one persistent filesystem scope on local shellctl."""

    endpoint: str
    auth_token: str
    session_root: str = "/home/dify/.dify-agent-sessions"
    snapshot_root: str = "/home/dify/.dify-agent-home-snapshots"
    client_factory: ShellctlClientFactory | None = None

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        handle = _validated_handle(spec.runtime_session_id)
        lease = self._lease(handle)
        session_dir = self._session_dir(handle)
        snapshot_dir = f"{self.snapshot_root.rstrip('/')}/{_validated_handle(spec.home_snapshot_ref)}"
        script = "\n".join(
            [
                "set -eu",
                f"test -d {shlex.quote(snapshot_dir)}",
                f"mkdir -p {shlex.quote(lease.layout.home_dir)} {shlex.quote(lease.layout.workspace_dir)}",
                f"cp -a {shlex.quote(snapshot_dir)}/. {shlex.quote(lease.layout.home_dir)}/",
                f"chmod 700 {shlex.quote(session_dir)} {shlex.quote(lease.layout.home_dir)}",
            ]
        )
        try:
            result = await run_shellctl_control_command(lease.commands, script)
            if result.exit_code != 0:
                raise SandboxCreateError(result.output)
            return lease
        except BaseException as exc:
            try:
                cleanup_result = await run_shellctl_control_command(
                    lease.commands,
                    f"rm -rf -- {shlex.quote(session_dir)}",
                )
                if cleanup_result.exit_code != 0:
                    logger.warning(
                        "failed to remove partial local sandbox scope",
                        extra={"sandbox_handle": handle, "cleanup_output": cleanup_result.output},
                    )
            except BaseException:
                logger.warning(
                    "failed to remove partial local sandbox scope",
                    exc_info=True,
                    extra={"sandbox_handle": handle},
                )
            try:
                await lease.close()
            except BaseException:
                logger.warning(
                    "failed to close local sandbox lease after create failure",
                    exc_info=True,
                    extra={"sandbox_handle": handle},
                )
            if isinstance(exc, SandboxCreateError):
                raise
            if isinstance(exc, Exception):
                raise SandboxCreateError(str(exc)) from exc
            raise

    async def resume(self, handle: str) -> SandboxLease:
        lease = self._lease(_validated_handle(handle))
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"test -d {shlex.quote(lease.layout.workspace_dir)}",
                timeout=10.0,
            )
            if result.exit_code != 0:
                raise SandboxLostError(f"Local sandbox scope {handle!r} no longer exists")
            return lease
        except BaseException as exc:
            try:
                await lease.close()
            except BaseException:
                logger.warning(
                    "failed to close local sandbox lease after resume failure",
                    exc_info=True,
                    extra={"sandbox_handle": handle},
                )
            if isinstance(exc, SandboxLostError):
                raise
            if isinstance(exc, Exception):
                raise SandboxResumeError(str(exc)) from exc
            raise

    async def suspend(self, lease: SandboxLease) -> None:
        if not isinstance(lease, ShellctlSandboxLease):
            raise TypeError("LocalSandboxDriver can only suspend its own shellctl leases")
        try:
            await lease.close()
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc

    async def delete(self, handle: str) -> None:
        normalized = _validated_handle(handle)
        lease = self._lease(normalized)
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"rm -rf -- {shlex.quote(self._session_dir(normalized))}",
            )
            if result.exit_code != 0:
                raise SandboxCleanupError(result.output)
        finally:
            await lease.close()

    def _lease(self, handle: str) -> ShellctlSandboxLease:
        session_dir = self._session_dir(handle)
        return create_shellctl_lease(
            handle=handle,
            layout=SandboxLayout(
                home_dir=f"{session_dir}/home",
                workspace_dir=f"{session_dir}/workspace",
            ),
            entrypoint=self.endpoint,
            token=self.auth_token,
            client_factory=self.client_factory,
        )

    def _session_dir(self, handle: str) -> str:
        return f"{self.session_root.rstrip('/')}/{handle}"


def _local_snapshot_ref(source_digest: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]", "-", source_digest.strip())
    if not normalized:
        raise HomeSnapshotCreateError("source_digest must identify the immutable Home Snapshot source")
    return f"home-{normalized[:80]}"


def _validated_handle(value: str) -> str:
    if value in {".", ".."} or _SAFE_HANDLE.fullmatch(value) is None:
        raise ValueError("runtime backend handle must be a safe path segment")
    return value


def _validated_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or "~" in path.parts:
        raise HomeSnapshotCreateError("Home Snapshot file paths must be home-relative")
    return str(path)


__all__ = ["LocalHomeSnapshotDriver", "LocalSandboxDriver"]
