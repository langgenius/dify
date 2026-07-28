"""Enterprise Gateway adapter for the working-environment protocol.

The existing Gateway can allocate, reconnect to, and delete a sandbox, but it
does not expose immutable Home Snapshot operations. One physical sandbox owns
both the materialized Home and Workspace, so their cleanup is coupled. Runtime
access remains operation-local and is routed through the Gateway's shellctl
proxy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import shlex
from typing import cast
from urllib.parse import quote

import httpx2 as httpx

from dify_agent.adapters.shell.protocols import ShellCommandProtocol, ShellProviderError
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol, ShellctlCommands
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    FileSystem,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import (
    ShellctlRuntimeLease,
    create_owned_shellctl_lease,
    run_shellctl_control_command,
)

logger = logging.getLogger(__name__)


def _not_implemented() -> NotImplementedError:
    return NotImplementedError("Enterprise Gateway does not implement immutable Home Snapshot operations")


@dataclass(slots=True)
class EnterpriseHomeSnapshotBackend:
    """Reject Home Snapshot operations until the Gateway exposes immutable snapshots."""

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        del spec, source
        raise _not_implemented()

    async def delete(self, snapshot_ref: str) -> None:
        del snapshot_ref
        raise _not_implemented()


@dataclass(slots=True)
class EnterpriseExecutionBindingBackend:
    """Manage Gateway sandboxes as coupled physical Bindings and Workspaces."""

    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0
    proxy_timeout: float = 60.0
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        """Create a default Gateway sandbox and initialize its canonical layout."""
        if spec.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("current Enterprise backend cannot attach to an existing Workspace")
        if spec.home_snapshot_ref is not None:
            raise BindingCreateError("current Enterprise backend cannot materialize an immutable Home Snapshot")

        sandbox_id: str | None = None
        data_plane: ShellctlRuntimeLease | None = None
        headers = {"X-Inner-Api-Key": self.auth_token} if self.auth_token else {}
        try:
            async with httpx.AsyncClient(
                base_url=self.gateway_endpoint.rstrip("/"),
                headers=headers,
                timeout=httpx.Timeout(self.gateway_timeout),
            ) as client:
                response = await client.post("/v1/sandboxes", json={"tenantId": spec.tenant_id})
                _ = response.raise_for_status()
                payload = response.json()
            sandbox_id_value = payload.get("sandboxId") if isinstance(payload, dict) else None
            if not isinstance(sandbox_id_value, str) or not sandbox_id_value:
                raise BindingCreateError("Enterprise Gateway returned an invalid sandbox id")
            sandbox_id = sandbox_id_value

            data_plane = await self._create_data_plane(sandbox_id)
            result = await run_shellctl_control_command(
                ShellctlCommands(client=data_plane.client),
                "\n".join(
                    [
                        "set -eu",
                        f"mkdir -p {shlex.quote(self.layout.home_dir)}",
                        f"rm -rf -- {shlex.quote(self.layout.workspace_dir)}",
                        f"mkdir -p {shlex.quote(self.layout.workspace_dir)}",
                        f"chmod 700 {shlex.quote(self.layout.home_dir)} {shlex.quote(self.layout.workspace_dir)}",
                    ]
                ),
            )
            if result.exit_code != 0:
                raise BindingCreateError(result.output)
            await data_plane.close()
            data_plane = None
            return ExecutionBindingAllocation(binding_ref=sandbox_id, workspace_ref=sandbox_id)
        except BaseException as exc:
            await _close_best_effort(data_plane, binding_ref=sandbox_id or spec.binding_id)
            if sandbox_id is not None:
                await self._delete_sandbox_best_effort(sandbox_id)
            if isinstance(exc, BindingCreateError):
                raise
            if isinstance(exc, Exception):
                raise BindingCreateError(str(exc)) from exc
            raise

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        """Reconnect to one existing Gateway sandbox without creating a replacement."""
        data_plane: ShellctlRuntimeLease | None = None
        try:
            data_plane = await self._create_data_plane(binding_ref)
            validation_commands = ShellctlCommands(client=data_plane.client)
            result = await run_shellctl_control_command(
                validation_commands,
                "\n".join(
                    [
                        "set -eu",
                        f"test -d {shlex.quote(self.layout.home_dir)}",
                        f"test -d {shlex.quote(self.layout.workspace_dir)}",
                    ]
                ),
                timeout=5.0,
            )
            if result.exit_code != 0:
                raise BindingLostError(f"Enterprise Binding {binding_ref!r} no longer contains its Home or Workspace")
            return EnterpriseRuntimeLease(data_plane=data_plane)
        except ShellProviderError as exc:
            await _close_best_effort(data_plane, binding_ref=binding_ref)
            if _is_missing_sandbox(exc):
                raise BindingLostError(f"Enterprise Binding {binding_ref!r} no longer exists") from exc
            raise BindingAcquireError(str(exc)) from exc
        except BindingLostError:
            await _close_best_effort(data_plane, binding_ref=binding_ref)
            raise
        except BaseException as exc:
            await _close_best_effort(data_plane, binding_ref=binding_ref)
            if isinstance(exc, Exception):
                raise BindingAcquireError(str(exc)) from exc
            raise

    async def release(self, lease: RuntimeLease) -> None:
        """Close operation-local shellctl resources without deleting the sandbox."""
        if not isinstance(lease, EnterpriseRuntimeLease):
            raise TypeError("EnterpriseExecutionBindingBackend can only release its own RuntimeLease")
        try:
            await lease.data_plane.close()
        except Exception as exc:
            raise BindingAcquireError(str(exc)) from exc

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        """Delete the coupled sandbox only when its Workspace is also retired."""
        if not spec.destroy_workspace:
            raise WorkspacePreservationUnsupportedError(
                "current Enterprise backend cannot destroy a Binding while preserving its Workspace"
            )
        if spec.workspace_ref != spec.binding_ref:
            raise BindingDestroyError("Enterprise Workspace ref must equal its Binding ref")

        try:
            await self._delete_sandbox(spec.binding_ref)
        except (httpx.TimeoutException, httpx.RequestError, httpx.HTTPStatusError) as exc:
            raise BindingDestroyError(str(exc)) from exc

    async def _delete_sandbox(self, sandbox_id: str) -> None:
        headers = {"X-Inner-Api-Key": self.auth_token} if self.auth_token else {}
        encoded_sandbox_id = quote(sandbox_id, safe="")
        async with httpx.AsyncClient(
            base_url=self.gateway_endpoint.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(self.gateway_timeout),
        ) as client:
            response = await client.delete(f"/v1/sandboxes/{encoded_sandbox_id}")
            if response.status_code == 404:
                return
            _ = response.raise_for_status()

    async def _delete_sandbox_best_effort(self, sandbox_id: str) -> None:
        try:
            await self._delete_sandbox(sandbox_id)
        except BaseException:
            logger.warning(
                "failed to delete Enterprise sandbox after Binding creation failed",
                exc_info=True,
                extra={"binding_ref": sandbox_id},
            )

    async def _create_data_plane(self, binding_ref: str) -> ShellctlRuntimeLease:
        proxy_base_url = f"{self.gateway_endpoint.rstrip('/')}/proxy/"
        headers = {"X-Sandbox-Id": binding_ref}
        if self.auth_token:
            headers["X-Inner-Api-Key"] = self.auth_token
        http_client = httpx.AsyncClient(
            base_url=proxy_base_url,
            headers=headers,
            follow_redirects=True,
            timeout=httpx.Timeout(self.proxy_timeout),
            transport=httpx.AsyncHTTPTransport(retries=3),
        )

        def client_factory() -> ShellctlClientProtocol:
            from shellctl.client import ShellctlClient

            return cast(
                ShellctlClientProtocol,
                cast(object, ShellctlClient(proxy_base_url, token=self.auth_token, client=http_client)),
            )

        return await create_owned_shellctl_lease(
            handle=binding_ref,
            layout=self.layout,
            entrypoint=proxy_base_url,
            token=self.auth_token,
            client_factory=client_factory,
            owned_transport=http_client,
        )


@dataclass(slots=True)
class EnterpriseRuntimeLease:
    """Invocation-local Enterprise shellctl connection and canonical layout."""

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

    @property
    def files(self) -> FileSystem:
        return self.data_plane.files


def _is_missing_sandbox(exc: ShellProviderError) -> bool:
    return exc.status_code == 404 or (exc.code or "").casefold() in {
        "not_found",
        "sandbox_expired",
        "sandbox_not_found",
    }


async def _close_best_effort(data_plane: ShellctlRuntimeLease | None, *, binding_ref: str) -> None:
    if data_plane is None:
        return
    try:
        await data_plane.close()
    except BaseException:
        logger.warning(
            "failed to close Enterprise RuntimeLease after acquisition failed",
            exc_info=True,
            extra={"binding_ref": binding_ref},
        )


__all__ = [
    "EnterpriseExecutionBindingBackend",
    "EnterpriseHomeSnapshotBackend",
    "EnterpriseRuntimeLease",
]
