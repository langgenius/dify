"""E2B control plane with shellctl as the common command/file data plane.

The SDK is imported only by the concrete control-plane adapter. Public layer
state contains only E2B sandbox/snapshot IDs; API keys, traffic tokens, SDK
objects, and shellctl clients remain invocation-local.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Literal, Protocol, cast

import httpx2 as httpx

from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
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
from dify_agent.runtime_backend.shellctl import ShellctlSandboxLease, create_owned_shellctl_lease

if TYPE_CHECKING:
    from e2b.connection_config import ApiParams

E2B_MAX_ACTIVE_TIMEOUT_SECONDS = 60 * 60


class _E2BControlPlaneNotFoundError(RuntimeError):
    """Typed boundary error for SDK resources that no longer exist."""


class _E2BFileSystem(Protocol):
    async def write(self, path: str, data: bytes) -> object: ...

    async def make_dir(self, path: str) -> bool: ...

    async def exists(self, path: str) -> bool: ...


class _E2BSnapshotInfo(Protocol):
    snapshot_id: str
    names: list[str]


class _E2BSandbox(Protocol):
    sandbox_id: str
    traffic_access_token: str | None
    files: _E2BFileSystem

    def get_host(self, port: int) -> str: ...

    async def pause(self, keep_memory: bool = True) -> bool: ...

    async def kill(self) -> bool: ...

    async def create_snapshot(self, name: str | None = None) -> _E2BSnapshotInfo: ...


class E2BControlPlane(Protocol):
    async def create(
        self,
        template: str,
        *,
        timeout: int,
        metadata: dict[str, str],
        on_timeout: Literal["kill", "pause"],
    ) -> _E2BSandbox: ...

    async def connect(self, handle: str, *, timeout: int) -> _E2BSandbox: ...

    async def kill(self, handle: str) -> bool: ...

    async def delete_snapshot(self, snapshot_ref: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class E2BSDKControlPlane:
    """Stateless async E2B SDK boundary configured with one deployment API key.

    SDK Sandbox objects are returned only to invocation-local drivers. Native
    not-found exceptions are normalized so drivers can distinguish confirmed
    resource loss from transient resume and cleanup failures.
    """

    api_key: str

    def _options(self) -> ApiParams:
        return {"api_key": self.api_key}

    async def create(
        self,
        template: str,
        *,
        timeout: int,
        metadata: dict[str, str],
        on_timeout: Literal["kill", "pause"],
    ) -> _E2BSandbox:
        from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException

        try:
            return cast(
                _E2BSandbox,
                cast(
                    object,
                    await AsyncSandbox.create(
                        template,
                        timeout=timeout,
                        metadata=metadata,
                        lifecycle={"on_timeout": on_timeout, "auto_resume": False},
                        **self._options(),
                    ),
                ),
            )
        except (SandboxNotFoundException, NotFoundException) as exc:
            raise _E2BControlPlaneNotFoundError(str(exc)) from exc

    async def connect(self, handle: str, *, timeout: int) -> _E2BSandbox:
        from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException

        try:
            return cast(
                _E2BSandbox,
                cast(object, await AsyncSandbox.connect(handle, timeout=timeout, **self._options())),
            )
        except (SandboxNotFoundException, NotFoundException) as exc:
            raise _E2BControlPlaneNotFoundError(str(exc)) from exc

    async def kill(self, handle: str) -> bool:
        from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException

        try:
            return await AsyncSandbox.kill(handle, **self._options())
        except (SandboxNotFoundException, NotFoundException) as exc:
            raise _E2BControlPlaneNotFoundError(str(exc)) from exc

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException

        try:
            return await AsyncSandbox.delete_snapshot(snapshot_ref, **self._options())
        except (SandboxNotFoundException, NotFoundException) as exc:
            raise _E2BControlPlaneNotFoundError(str(exc)) from exc


@dataclass(slots=True)
class E2BHomeSnapshotDriver:
    """Build immutable E2B Home Snapshots from the prepared deployment template.

    Create starts a temporary Sandbox, writes canonical Home files, snapshots
    it, and best-effort kills the builder even on cancellation or failure. The
    Dify API owns the returned snapshot id. Builder timeout uses ``kill``;
    delete removes only the immutable snapshot and treats not found as success.
    """

    control_plane: E2BControlPlane
    template: str
    active_timeout_seconds: int
    home_dir: str = "/home/dify"

    async def create(self, request: CreateHomeSnapshotRequest) -> str:
        sandbox: _E2BSandbox | None = None
        try:
            sandbox = await self.control_plane.create(
                self.template,
                timeout=self.active_timeout_seconds,
                metadata={
                    "dify.resource": "home-snapshot-build",
                    "dify.tenant_id": request.tenant_id,
                    "dify.agent_id": request.agent_id,
                    "dify.agent_config_version_id": request.agent_config_version_id,
                    "dify.source_digest": request.source_digest,
                },
                on_timeout="kill",
            )
            _ = await sandbox.files.make_dir(self.home_dir)
            for source_file in request.source.files:
                relative_path = _validated_home_relative_path(source_file.path)
                destination = f"{self.home_dir.rstrip('/')}/{relative_path}"
                parent = str(PurePosixPath(destination).parent)
                _ = await sandbox.files.make_dir(parent)
                _ = await sandbox.files.write(destination, source_file.content)
            snapshot = await sandbox.create_snapshot()
            return snapshot.snapshot_id
        except Exception as exc:
            raise HomeSnapshotCreateError(str(exc)) from exc
        finally:
            if sandbox is not None:
                try:
                    _ = await sandbox.kill()
                except Exception:
                    # Metadata keeps a failed build sandbox diagnosable when best-effort kill fails.
                    pass

    async def delete(self, snapshot_ref: str) -> None:
        try:
            _ = await self.control_plane.delete_snapshot(snapshot_ref)
        except _E2BControlPlaneNotFoundError:
            return
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc


@dataclass(slots=True)
class E2BSandboxDriver:
    """Manage retained E2B runtime Sandboxes and their shellctl data plane.

    Create boots from the immutable Home Snapshot ref, prepares Workspace, and
    returns a stable Sandbox id with invocation-local SDK and HTTP clients.
    Resume connects only to that id and fails if Sandbox or Workspace is lost.
    Suspend closes shellctl then pauses with memory preserved; delete kills the
    Sandbox and its current Workspace idempotently. Active timeout pauses runtime
    Sandboxes and is not a resource-age TTL.
    """

    control_plane: E2BControlPlane
    active_timeout_seconds: int
    shellctl_auth_token: str = ""
    shellctl_port: int = 5004
    layout: SandboxLayout = field(
        default_factory=lambda: SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        sandbox: _E2BSandbox | None = None
        try:
            sandbox = await self.control_plane.create(
                spec.home_snapshot_ref,
                timeout=self.active_timeout_seconds,
                metadata={
                    "dify.resource": "runtime-sandbox",
                    "dify.runtime_session_id": spec.runtime_session_id,
                    "dify.tenant_id": spec.tenant_id,
                    "dify.agent_id": spec.agent_id,
                    "dify.agent_config_version_id": spec.agent_config_version_id,
                },
                on_timeout="pause",
            )
            _ = await sandbox.files.make_dir(self.layout.workspace_dir)
            return await self._lease(sandbox)
        except BaseException as exc:
            if sandbox is not None:
                try:
                    _ = await sandbox.kill()
                except BaseException:
                    pass
            if isinstance(exc, Exception):
                raise SandboxCreateError(str(exc)) from exc
            raise

    async def resume(self, handle: str) -> SandboxLease:
        sandbox: _E2BSandbox | None = None
        try:
            sandbox = await self.control_plane.connect(handle, timeout=self.active_timeout_seconds)
            if not await sandbox.files.exists(self.layout.workspace_dir):
                raise SandboxLostError(f"E2B sandbox {handle!r} no longer contains its workspace")
            return await self._lease(sandbox)
        except _E2BControlPlaneNotFoundError as exc:
            raise SandboxLostError(f"E2B sandbox {handle!r} no longer exists") from exc
        except SandboxLostError:
            await _best_effort_pause(sandbox)
            raise
        except BaseException as exc:
            await _best_effort_pause(sandbox)
            if isinstance(exc, Exception):
                raise SandboxResumeError(str(exc)) from exc
            raise

    async def suspend(self, lease: SandboxLease) -> None:
        if not isinstance(lease, E2BSandboxLease):
            raise TypeError("E2BSandboxDriver can only suspend its own leases")
        close_error: Exception | None = None
        try:
            await lease.data_plane.close()
        except Exception as exc:
            close_error = exc
        try:
            _ = await lease.sandbox.pause(keep_memory=True)
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc
        if close_error is not None:
            raise SandboxCleanupError(str(close_error)) from close_error

    async def delete(self, handle: str) -> None:
        try:
            _ = await self.control_plane.kill(handle)
        except _E2BControlPlaneNotFoundError:
            return
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc

    async def _lease(self, sandbox: _E2BSandbox) -> "E2BSandboxLease":
        entrypoint = f"https://{sandbox.get_host(self.shellctl_port)}"
        traffic_token = sandbox.traffic_access_token
        headers = {"X-Access-Token": traffic_token} if isinstance(traffic_token, str) and traffic_token else {}
        http_client = httpx.AsyncClient(
            base_url=entrypoint,
            headers=headers,
            follow_redirects=True,
            timeout=httpx.Timeout(60.0),
        )

        def client_factory() -> ShellctlClientProtocol:
            from shellctl.client import ShellctlClient

            return cast(
                ShellctlClientProtocol,
                cast(
                    object,
                    ShellctlClient(entrypoint, token=self.shellctl_auth_token, client=http_client),
                ),
            )

        data_plane = await create_owned_shellctl_lease(
            handle=sandbox.sandbox_id,
            layout=self.layout,
            entrypoint=entrypoint,
            token=self.shellctl_auth_token,
            client_factory=client_factory,
            owned_transport=http_client,
        )
        return E2BSandboxLease(sandbox=sandbox, data_plane=data_plane)


@dataclass(slots=True)
class E2BSandboxLease:
    """Invocation-local E2B SDK object plus the owned shellctl data-plane lease."""

    sandbox: _E2BSandbox
    data_plane: ShellctlSandboxLease

    @property
    def handle(self) -> str:
        return self.data_plane.handle

    @property
    def layout(self) -> SandboxLayout:
        return self.data_plane.layout

    @property
    def commands(self):
        return self.data_plane.commands

    @property
    def files(self):
        return self.data_plane.files


def _validated_home_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or "~" in path.parts:
        raise HomeSnapshotCreateError("Home Snapshot file paths must be home-relative")
    return str(path)


async def _best_effort_pause(sandbox: _E2BSandbox | None) -> None:
    if sandbox is None:
        return
    try:
        _ = await sandbox.pause(keep_memory=True)
    except BaseException:
        pass


__all__ = [
    "E2B_MAX_ACTIVE_TIMEOUT_SECONDS",
    "E2BControlPlane",
    "E2BHomeSnapshotDriver",
    "E2BSDKControlPlane",
    "E2BSandboxDriver",
    "E2BSandboxLease",
]
