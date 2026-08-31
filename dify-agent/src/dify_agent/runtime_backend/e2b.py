"""E2B backend adapters with shellctl as the command and file data plane.

Dify API persists only opaque Home Snapshot, Binding, and Workspace backend
refs. This adapter maps those refs to E2B resources internally. API keys,
traffic tokens, SDK objects, shellctl clients, and ``RuntimeLease`` objects stay
operation-local and are never serialized into Agenton state.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal, Protocol, cast

import httpx2 as httpx
from shellctl.client import ShellctlClientError

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    HomeSnapshotCreateError,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease, create_owned_shellctl_lease

if TYPE_CHECKING:
    from e2b.connection_config import ApiParams

# One RuntimeLease spans the complete Agent run, not one Shell tool call.
E2B_MAX_ACTIVE_TIMEOUT_SECONDS = 60 * 60
_SHELLCTL_READY_MAX_ATTEMPTS = 3
_SHELLCTL_READY_RETRY_INTERVAL_SECONDS = 0.5


class _E2BControlPlaneNotFoundError(RuntimeError):
    """Typed boundary error for SDK resources that no longer exist."""


class _E2BFileEntry(Protocol):
    path: str


class _E2BFileSystem(Protocol):
    async def make_dir(self, path: str) -> bool: ...

    async def exists(self, path: str) -> bool: ...

    async def list(self, path: str) -> list[_E2BFileEntry]: ...

    async def remove(self, path: str) -> None: ...


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

    SDK Sandbox objects are returned only to operation-local backend adapters.
    Native not-found exceptions are normalized so adapters can distinguish
    confirmed resource loss from transient acquisition and cleanup failures.
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
                        network={"allow_public_traffic": False},
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
class E2BHomeSnapshotBackend:
    """Implement immutable Home Snapshot operations with E2B snapshots.

    Build Apply snapshots the E2B resource behind the supplied ``RuntimeLease``.
    Dify API stores the returned value as an opaque backend ref; this adapter
    keeps no cross-request state.
    """

    control_plane: E2BControlPlane

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        """Create an immutable E2B snapshot from the source Binding's active lease."""
        del spec
        if not isinstance(source, E2BRuntimeLease):
            raise HomeSnapshotCreateError("E2B Home Snapshot requires an E2B RuntimeLease")
        try:
            snapshot = await source.sandbox.create_snapshot()
            return snapshot.snapshot_id
        except BaseException as exc:
            if isinstance(exc, Exception):
                raise HomeSnapshotCreateError(str(exc)) from exc
            raise

    async def delete(self, snapshot_ref: str) -> None:
        try:
            _ = await self.control_plane.delete_snapshot(snapshot_ref)
        except _E2BControlPlaneNotFoundError:
            return
        except Exception as exc:
            raise BindingDestroyError(str(exc)) from exc


@dataclass(slots=True)
class E2BExecutionBindingBackend:
    """Implement Execution Binding operations with E2B and shellctl.

    In this backend one physical E2B resource represents both a Binding and its
    Workspace, so their opaque refs have the same value. Materialized Home and
    Workspace remain distinct logical resources even though E2B couples their
    physical lifecycle. Active timeout pauses the resource and is not a
    resource-age TTL.
    """

    control_plane: E2BControlPlane
    template: str
    active_timeout_seconds: int
    shellctl_port: int = 5004
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace")
    )

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        """Create one paused E2B resource from a snapshot or deployment template."""
        if spec.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("current E2B backend cannot attach to an existing Workspace")
        sandbox: _E2BSandbox | None = None
        try:
            sandbox = await self.control_plane.create(
                self.template if spec.home_snapshot_ref is None else spec.home_snapshot_ref,
                timeout=self.active_timeout_seconds,
                metadata={
                    "dify.resource": "runtime-sandbox",
                    "dify.binding_id": spec.binding_id,
                    "dify.workspace_id": spec.workspace_id,
                    "dify.tenant_id": spec.tenant_id,
                    "dify.agent_id": spec.agent_id,
                },
                on_timeout="pause",
            )
            _ = await sandbox.files.make_dir(self.layout.workspace_dir)
            for entry in await sandbox.files.list(self.layout.workspace_dir):
                await sandbox.files.remove(entry.path)
            sandbox_id = sandbox.sandbox_id
            _ = await sandbox.pause(keep_memory=True)
            return ExecutionBindingAllocation(binding_ref=sandbox_id, workspace_ref=sandbox_id)
        except BaseException as exc:
            if sandbox is not None:
                try:
                    _ = await sandbox.kill()
                except BaseException:
                    pass
            if isinstance(exc, Exception):
                if isinstance(exc, BindingCreateError):
                    raise
                raise BindingCreateError(str(exc)) from exc
            raise

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        """Acquire operation-scoped shellctl access for an opaque Binding ref."""
        sandbox: _E2BSandbox | None = None
        lease: E2BRuntimeLease | None = None
        try:
            sandbox = await self.control_plane.connect(binding_ref, timeout=self.active_timeout_seconds)
            if not await sandbox.files.exists(self.layout.workspace_dir):
                raise BindingLostError(f"E2B Binding {binding_ref!r} no longer contains its Workspace")
            lease = await self._lease(sandbox)
            await _wait_for_shellctl_ready(lease.data_plane.client)
            return lease
        except _E2BControlPlaneNotFoundError as exc:
            raise BindingLostError(f"E2B Binding {binding_ref!r} no longer exists") from exc
        except BindingLostError:
            await _best_effort_pause(sandbox)
            raise
        except BaseException as exc:
            await _best_effort_close_data_plane(lease)
            await _best_effort_pause(sandbox)
            if isinstance(exc, Exception):
                raise BindingAcquireError(str(exc)) from exc
            raise

    async def release(self, lease: RuntimeLease) -> None:
        """Close operation-local transports and pause the physical E2B resource."""
        if not isinstance(lease, E2BRuntimeLease):
            raise TypeError("E2BExecutionBindingBackend can only release its own RuntimeLease")
        close_error: Exception | None = None
        try:
            await lease.data_plane.close()
        except Exception as exc:
            close_error = exc
        try:
            _ = await lease.sandbox.pause(keep_memory=True)
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc
        if close_error is not None:
            raise BindingAcquireError(str(close_error)) from close_error

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        """Destroy the coupled physical Binding and Workspace idempotently."""
        if not spec.destroy_workspace:
            raise WorkspacePreservationUnsupportedError(
                "current E2B backend cannot destroy a Binding while preserving its Workspace"
            )
        if spec.workspace_ref != spec.binding_ref:
            raise BindingDestroyError("E2B Workspace ref must equal its Binding ref")
        try:
            _ = await self.control_plane.kill(spec.binding_ref)
        except _E2BControlPlaneNotFoundError:
            return
        except Exception as exc:
            raise BindingDestroyError(str(exc)) from exc

    async def _lease(self, sandbox: _E2BSandbox) -> "E2BRuntimeLease":
        entrypoint = f"https://{sandbox.get_host(self.shellctl_port)}"
        traffic_token = sandbox.traffic_access_token
        if not isinstance(traffic_token, str) or not traffic_token:
            raise BindingAcquireError("E2B sandbox did not provide a traffic access token")
        http_client = httpx.AsyncClient(
            base_url=entrypoint,
            headers={"e2b-traffic-access-token": traffic_token},
            follow_redirects=True,
            timeout=httpx.Timeout(60.0),
        )

        # Explicit token="" prevents process-level SHELLCTL_AUTH_TOKEN fallback;
        # E2B port access is authenticated only by e2b-traffic-access-token above.
        def client_factory() -> ShellctlClientProtocol:
            from shellctl.client import ShellctlClient

            return cast(
                ShellctlClientProtocol,
                cast(
                    object,
                    ShellctlClient(entrypoint, token="", client=http_client),
                ),
            )

        data_plane = await create_owned_shellctl_lease(
            handle=sandbox.sandbox_id,
            layout=self.layout,
            entrypoint=entrypoint,
            token="",
            client_factory=client_factory,
            owned_transport=http_client,
        )
        return E2BRuntimeLease(sandbox=sandbox, data_plane=data_plane)


@dataclass(slots=True)
class E2BRuntimeLease:
    """Invocation-local E2B SDK object plus the owned shellctl data-plane lease."""

    sandbox: _E2BSandbox
    data_plane: ShellctlRuntimeLease

    @property
    def handle(self) -> str:
        return self.data_plane.handle

    @property
    def layout(self) -> RuntimeLayout:
        return self.data_plane.layout

    @property
    def commands(self) -> ShellCommandProtocol:
        return self.data_plane.commands


async def _wait_for_shellctl_ready(client: ShellctlClientProtocol) -> None:
    for attempt in range(_SHELLCTL_READY_MAX_ATTEMPTS):
        try:
            _ = await client.health()
            return
        except (httpx.TimeoutException, httpx.RequestError):
            if attempt == _SHELLCTL_READY_MAX_ATTEMPTS - 1:
                raise
        except ShellctlClientError as exc:
            if not 500 <= exc.status_code < 600 or attempt == _SHELLCTL_READY_MAX_ATTEMPTS - 1:
                raise
        await asyncio.sleep(_SHELLCTL_READY_RETRY_INTERVAL_SECONDS)


async def _best_effort_close_data_plane(lease: E2BRuntimeLease | None) -> None:
    if lease is None:
        return
    try:
        await lease.data_plane.close()
    except BaseException:
        pass


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
    "E2BExecutionBindingBackend",
    "E2BHomeSnapshotBackend",
    "E2BSDKControlPlane",
    "E2BRuntimeLease",
]
