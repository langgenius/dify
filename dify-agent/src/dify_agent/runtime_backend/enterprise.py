"""Enterprise Gateway adapter for the working-environment protocol.

The Gateway owns immutable Home Snapshot capture, restore, and deletion, in
addition to allocating, reconnecting to, and deleting a sandbox. Restore
arrives as a `homeSnapshotRef` parameter on sandbox creation rather than its
own call. One physical sandbox owns both the materialized Home and Workspace,
so their cleanup is coupled. Runtime access remains operation-local and is
routed through the Gateway's shellctl proxy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus
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
    HomeSnapshotCreateError,
    HomeSnapshotTooLargeError,
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
from dify_agent.runtime_backend.shellctl import (
    ShellctlRuntimeLease,
    create_owned_shellctl_lease,
    run_shellctl_control_command,
)

logger = logging.getLogger(__name__)

_GATEWAY_AUTH_HEADER = "X-Inner-Api-Key"


class _GatewayStatusError(RuntimeError):
    """One failed Gateway control-plane call, with its reason when it sent one."""

    def __init__(self, response: httpx.Response) -> None:
        self.status_code = response.status_code
        self.reason = ""
        detail = response.text
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            reason = payload.get("reason")
            message = payload.get("message")
            if isinstance(reason, str):
                self.reason = reason
            if isinstance(message, str) and message:
                detail = message
        self.detail = detail
        super().__init__(f"{self.status_code} {self.reason or 'gateway_error'}: {detail}")


async def _gateway_request(
    *,
    endpoint: str,
    auth_token: str,
    timeout: float,
    method: str,
    path: str,
    json_body: dict[str, object] | None = None,
    absent_status: int | None = None,
) -> dict[str, object] | None:
    """Call one Gateway control-plane endpoint and decode its reply."""
    headers = {_GATEWAY_AUTH_HEADER: auth_token} if auth_token else {}
    async with httpx.AsyncClient(
        base_url=endpoint.rstrip("/"),
        headers=headers,
        timeout=httpx.Timeout(timeout),
    ) as client:
        response = await client.request(method, path, json=json_body)
    if absent_status is not None and response.status_code == absent_status:
        return None
    if response.status_code >= 400:
        raise _GatewayStatusError(response)
    if not response.content:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


@dataclass(slots=True)
class EnterpriseHomeSnapshotBackend:
    """Manage immutable Home Snapshots through the Gateway's snapshot endpoints."""

    gateway_endpoint: str
    auth_token: str
    snapshot_timeout: float = 35.0

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        """Capture the source lease's Home through the Gateway's snapshot endpoint."""
        if not isinstance(source, EnterpriseRuntimeLease):
            raise HomeSnapshotCreateError("Enterprise Home Snapshot requires an Enterprise RuntimeLease")
        try:
            payload = await _gateway_request(
                endpoint=self.gateway_endpoint,
                auth_token=self.auth_token,
                timeout=self.snapshot_timeout,
                method="POST",
                path=f"/v1/sandboxes/{quote(source.handle, safe='')}/home-snapshots",
                json_body={
                    "tenantId": spec.tenant_id,
                    "agentId": spec.agent_id,
                    "homeSnapshotId": spec.home_snapshot_id,
                },
            )
        except _GatewayStatusError as exc:
            if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
                raise HomeSnapshotTooLargeError(exc.detail) from exc
            raise HomeSnapshotCreateError(str(exc)) from exc
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            raise HomeSnapshotCreateError(str(exc)) from exc
        snapshot_ref = payload.get("snapshotRef") if isinstance(payload, dict) else None
        if not isinstance(snapshot_ref, str) or not snapshot_ref:
            raise HomeSnapshotCreateError("Enterprise Gateway returned an invalid snapshot ref")
        return snapshot_ref

    async def delete(self, snapshot_ref: str) -> None:
        """Delete one snapshot's artifacts."""
        try:
            _ = await _gateway_request(
                endpoint=self.gateway_endpoint,
                auth_token=self.auth_token,
                timeout=self.snapshot_timeout,
                method="DELETE",
                path=f"/v1/home-snapshots/{quote(snapshot_ref, safe='/')}",
            )
        except (_GatewayStatusError, httpx.TimeoutException, httpx.RequestError) as exc:
            raise BindingDestroyError(str(exc)) from exc


@dataclass(slots=True)
class EnterpriseExecutionBindingBackend:
    """Manage Gateway sandboxes as coupled physical Bindings and Workspaces."""

    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0
    proxy_timeout: float = 60.0
    snapshot_timeout: float = 35.0
    layout: RuntimeLayout = field(
        default_factory=lambda: RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace")
    )

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        """Create a default Gateway sandbox and initialize its canonical layout."""
        if spec.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("current Enterprise backend cannot attach to an existing Workspace")

        sandbox_id: str | None = None
        data_plane: ShellctlRuntimeLease | None = None
        try:
            create_body: dict[str, object] = {"tenantId": spec.tenant_id}
            if spec.home_snapshot_ref is not None:
                create_body["homeSnapshotRef"] = spec.home_snapshot_ref
            payload = await _gateway_request(
                endpoint=self.gateway_endpoint,
                auth_token=self.auth_token,
                timeout=self.snapshot_timeout if spec.home_snapshot_ref is not None else self.gateway_timeout,
                method="POST",
                path="/v1/sandboxes",
                json_body=create_body,
            )
            sandbox_id_value = payload.get("sandboxId") if isinstance(payload, dict) else None
            if not isinstance(sandbox_id_value, str) or not sandbox_id_value:
                raise BindingCreateError("Enterprise Gateway returned an invalid sandbox id")
            sandbox_id = sandbox_id_value

            data_plane = await self._create_data_plane(sandbox_id)
            result = await run_shellctl_control_command(
                ShellctlCommands(
                    client=data_plane.client,
                    home_dir=self.layout.home_dir,
                    workspace_dir=self.layout.workspace_dir,
                ),
                "\n".join(
                    [
                        "set -eu",
                        "exec 2>&1",
                        f"mkdir -p {shlex.quote(self.layout.home_dir)}",
                        f"find {shlex.quote(self.layout.workspace_dir)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +",
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
        except (_GatewayStatusError, httpx.TimeoutException, httpx.RequestError) as exc:
            raise BindingDestroyError(str(exc)) from exc

    async def _delete_sandbox(self, sandbox_id: str) -> None:
        _ = await _gateway_request(
            endpoint=self.gateway_endpoint,
            auth_token=self.auth_token,
            timeout=self.gateway_timeout,
            method="DELETE",
            path=f"/v1/sandboxes/{quote(sandbox_id, safe='')}",
            absent_status=404,
        )

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
