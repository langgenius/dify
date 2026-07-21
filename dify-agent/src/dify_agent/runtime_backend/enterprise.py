"""Enterprise Gateway control plane with the shared shellctl data plane."""

from __future__ import annotations

import base64
import logging
import shlex
from dataclasses import dataclass, field
from typing import TypedDict, cast

import httpx2 as httpx

from dify_agent.adapters.shell.protocols import ShellProviderError
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend.errors import (
    HomeSnapshotCreateError,
    SandboxBackendUnavailableError,
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
    create_owned_shellctl_lease,
    run_shellctl_control_command,
)

logger = logging.getLogger(__name__)


class _HomeSnapshotReply(TypedDict):
    snapshotRef: str


class _SandboxReply(TypedDict):
    sandboxId: str


class EnterpriseGatewayNotFoundError(RuntimeError):
    """Raised when Gateway confirms that a requested resource is absent."""


@dataclass(slots=True)
class EnterpriseGatewayClient:
    """Short-lived Enterprise control-plane client owned by one driver call.

    It maps transport, timeout, and HTTP failures into backend domain errors and
    closes its HTTP client before the operation returns. Shell data-plane proxy
    clients are created separately and belong to the returned lease.
    """

    endpoint: str
    auth_token: str
    timeout: float = 30.0
    _client: httpx.AsyncClient = field(init=False)

    def __post_init__(self) -> None:
        headers = {"X-Inner-Api-Key": self.auth_token} if self.auth_token else {}
        self._client = httpx.AsyncClient(
            base_url=self.endpoint.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(self.timeout),
        )

    async def create_home_snapshot(self, request: CreateHomeSnapshotRequest) -> str:
        response = await self._request(
            "POST",
            "/v1/home-snapshots",
            json_body={
                "tenantId": request.tenant_id,
                "agentId": request.agent_id,
                "agentConfigVersionId": request.agent_config_version_id,
                "sourceDigest": request.source_digest,
                "files": [
                    {"path": item.path, "contentBase64": base64.b64encode(item.content).decode("ascii")}
                    for item in request.source.files
                ],
            },
        )
        return cast(_HomeSnapshotReply, response.json())["snapshotRef"]

    async def delete_home_snapshot(self, snapshot_ref: str) -> None:
        _ = await self._request("DELETE", f"/v1/home-snapshots/{snapshot_ref}")

    async def create_sandbox(self, spec: SandboxCreateSpec) -> str:
        response = await self._request(
            "POST",
            "/v1/sandboxes",
            json_body={
                "runtimeSessionId": spec.runtime_session_id,
                "tenantId": spec.tenant_id,
                "agentId": spec.agent_id,
                "agentConfigVersionId": spec.agent_config_version_id,
                "homeSnapshotRef": spec.home_snapshot_ref,
            },
        )
        return cast(_SandboxReply, response.json())["sandboxId"]

    async def delete_sandbox(self, handle: str) -> None:
        _ = await self._request("DELETE", f"/v1/sandboxes/{handle}")

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, object] | None = None,
    ) -> httpx.Response:
        try:
            if json_body is None:
                response = await self._client.request(method, path)
            else:
                response = await self._client.request(method, path, json=json_body)
        except httpx.TimeoutException as exc:
            raise SandboxBackendUnavailableError(f"Enterprise Gateway timed out: {method} {path}") from exc
        except httpx.RequestError as exc:
            raise SandboxBackendUnavailableError(f"Enterprise Gateway request failed: {exc}") from exc
        if response.status_code == 404:
            raise EnterpriseGatewayNotFoundError(path)
        try:
            _ = response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SandboxBackendUnavailableError(
                f"Enterprise Gateway returned {response.status_code}: {response.text}"
            ) from exc
        return response


@dataclass(slots=True)
class EnterpriseHomeSnapshotDriver:
    """Create and retire immutable Home resources through Enterprise Gateway.

    Each operation owns a short-lived Gateway client. The Dify API persists the
    returned ref; this driver keeps no catalog or cross-request state. Create
    maps failures to ``HomeSnapshotCreateError`` and delete is idempotent when
    Gateway reports not found.
    """

    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0

    async def create(self, request: CreateHomeSnapshotRequest) -> str:
        gateway = self._gateway()
        try:
            return await gateway.create_home_snapshot(request)
        except Exception as exc:
            raise HomeSnapshotCreateError(str(exc)) from exc
        finally:
            await gateway.close()

    async def delete(self, snapshot_ref: str) -> None:
        gateway = self._gateway()
        try:
            await gateway.delete_home_snapshot(snapshot_ref)
        except EnterpriseGatewayNotFoundError:
            return
        finally:
            await gateway.close()

    def _gateway(self) -> EnterpriseGatewayClient:
        return EnterpriseGatewayClient(self.gateway_endpoint, self.auth_token, self.gateway_timeout)


@dataclass(slots=True)
class EnterpriseSandboxDriver:
    """Manage Enterprise pods through Gateway and lease their shellctl proxy.

    Create asks Gateway for a stable Sandbox id and rolls back partial resources
    best-effort if lease construction fails or is cancelled. Resume reconnects
    to the same id and verifies that Workspace still exists; it never creates a
    replacement. Suspend closes only invocation-local proxy resources, while
    delete asks Gateway to remove the retained pod and Workspace idempotently.
    """

    gateway_endpoint: str
    auth_token: str
    gateway_timeout: float = 30.0
    proxy_timeout: float = 60.0
    layout: SandboxLayout = field(
        default_factory=lambda: SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    )

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        gateway = self._gateway()
        handle: str | None = None
        lease: ShellctlSandboxLease | None = None
        gateway_close_attempted = False
        try:
            handle = await gateway.create_sandbox(spec)
            lease = await self._lease(handle)
            gateway_close_attempted = True
            await gateway.close()
            return lease
        except BaseException as exc:
            if lease is not None:
                await _best_effort_close_after_create_failure(lease)
            if handle is not None:
                await _best_effort_delete_after_create_failure(gateway, handle)
            if not gateway_close_attempted:
                await _best_effort_close_gateway_after_create_failure(gateway)
            if isinstance(exc, Exception):
                raise SandboxCreateError(str(exc)) from exc
            raise

    async def resume(self, handle: str) -> SandboxLease:
        try:
            lease = await self._lease(handle)
        except Exception as exc:
            raise SandboxResumeError(str(exc)) from exc
        try:
            result = await run_shellctl_control_command(
                lease.commands,
                f"test -d {shlex.quote(lease.layout.workspace_dir)}",
                timeout=5.0,
            )
            if result.exit_code != 0:
                raise SandboxLostError(f"Enterprise sandbox {handle!r} is unavailable")
            return lease
        except SandboxLostError:
            await _best_effort_close_after_resume_failure(lease)
            raise
        except Exception as exc:
            await _best_effort_close_after_resume_failure(lease)
            if _is_structured_missing_sandbox_error(exc):
                raise SandboxLostError(f"Enterprise sandbox {handle!r} no longer exists") from exc
            raise SandboxResumeError(str(exc)) from exc

    async def suspend(self, lease: SandboxLease) -> None:
        if not isinstance(lease, ShellctlSandboxLease):
            raise TypeError("EnterpriseSandboxDriver can only suspend its own leases")
        try:
            await lease.close()
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc

    async def delete(self, handle: str) -> None:
        gateway = self._gateway()
        try:
            await gateway.delete_sandbox(handle)
        except EnterpriseGatewayNotFoundError:
            return
        except Exception as exc:
            raise SandboxCleanupError(str(exc)) from exc
        finally:
            await gateway.close()

    def _gateway(self) -> EnterpriseGatewayClient:
        return EnterpriseGatewayClient(self.gateway_endpoint, self.auth_token, self.gateway_timeout)

    async def _lease(self, handle: str) -> ShellctlSandboxLease:
        proxy_base_url = f"{self.gateway_endpoint.rstrip('/')}/proxy/"
        headers: dict[str, str] = {"X-Sandbox-Id": handle}
        if self.auth_token:
            headers["X-Inner-Api-Key"] = self.auth_token

        proxy_http_client = httpx.AsyncClient(
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
                cast(object, ShellctlClient(proxy_base_url, token=self.auth_token, client=proxy_http_client)),
            )

        return await create_owned_shellctl_lease(
            handle=handle,
            layout=self.layout,
            entrypoint=proxy_base_url,
            token=self.auth_token,
            client_factory=client_factory,
            owned_transport=proxy_http_client,
        )


def _is_structured_missing_sandbox_error(exc: Exception) -> bool:
    return isinstance(exc, ShellProviderError) and (
        exc.status_code in {404, 410} or exc.code in {"not_found", "sandbox_not_found", "expired", "sandbox_expired"}
    )


async def _best_effort_close_after_resume_failure(lease: ShellctlSandboxLease) -> None:
    try:
        await lease.close()
    except Exception as exc:
        logger.warning("Failed to close Enterprise shellctl lease after resume failed: %s", exc)


async def _best_effort_close_after_create_failure(lease: ShellctlSandboxLease) -> None:
    try:
        await lease.close()
    except BaseException as exc:
        logger.warning("Failed to close Enterprise shellctl lease after create failed: %s", exc)


async def _best_effort_delete_after_create_failure(gateway: EnterpriseGatewayClient, handle: str) -> None:
    try:
        await gateway.delete_sandbox(handle)
    except BaseException as exc:
        logger.warning("Failed to delete Enterprise sandbox %r after create failed: %s", handle, exc)


async def _best_effort_close_gateway_after_create_failure(gateway: EnterpriseGatewayClient) -> None:
    try:
        await gateway.close()
    except BaseException as exc:
        logger.warning("Failed to close Enterprise Gateway after create failed: %s", exc)


__all__ = [
    "EnterpriseGatewayClient",
    "EnterpriseHomeSnapshotDriver",
    "EnterpriseSandboxDriver",
]
