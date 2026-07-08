from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TypedDict

import httpx

from dify_agent.adapters.shell.protocols import (
    SandboxExpiredError,
    ShellCommandProtocol,
    ShellFileTransferProtocol,
    ShellProviderError,
    ShellProviderProtocol,
    ShellResourceProtocol,
)
from dify_agent.adapters.shell.shellctl import (
    ShellctlClientProtocol,
    ShellctlCommands,
    ShellctlFileTransfer,
)

logger = logging.getLogger(__name__)


class _CreateSandboxReply(TypedDict):
    sandboxId: str
    status: str


# ---------------------------------------------------------------------------
# Gateway client (control plane)
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class EnterpriseGatewayClient:
    """HTTP client for the enterprise sandbox gateway control-plane API."""

    endpoint: str
    auth_token: str
    _client: httpx.AsyncClient = field(init=False)

    def __post_init__(self) -> None:
        headers: dict[str, str] = {}
        if self.auth_token:
            headers["X-Inner-Api-Key"] = self.auth_token
        self._client = httpx.AsyncClient(
            base_url=self.endpoint.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(30.0),
        )

    async def create_sandbox(
        self, *, tenant_id: str | None = None, template: str | None = None
    ) -> _CreateSandboxReply:
        body: dict[str, str] = {}
        if tenant_id:
            body["tenantId"] = tenant_id
        if template:
            body["template"] = template
        response = await self._request("POST", "/v1/sandboxes", json=body)
        return response.json()

    async def delete_sandbox(self, sandbox_id: str) -> None:
        await self._request("DELETE", f"/v1/sandboxes/{sandbox_id}")

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        try:
            response = await self._client.request(method, path, **kwargs)
            response.raise_for_status()
            return response
        except httpx.TimeoutException as exc:
            raise ShellProviderError(
                f"Gateway request timed out: {method} {path}", code="timeout"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise ShellProviderError(
                f"Gateway returned {exc.response.status_code}: {exc.response.text}",
                code="gateway_error",
            ) from exc
        except httpx.RequestError as exc:
            raise ShellProviderError(
                f"Gateway request failed: {exc}", code="request_error"
            ) from exc


# ---------------------------------------------------------------------------
# Resource & Provider
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class EnterpriseResource(ShellResourceProtocol):
    """A live enterprise sandbox session.

    Holds the gateway client, sandbox ID, and the shellctl client for data-plane
    operations. ``suspend()`` closes the shellctl and gateway clients without
    deleting the sandbox, so the same sandbox can be re-attached later.
    ``delete()`` additionally calls the gateway to destroy the sandbox pod.
    """

    _sandbox_id: str
    gateway: EnterpriseGatewayClient
    shellctl_client: ShellctlClientProtocol
    commands: ShellCommandProtocol
    files: ShellFileTransferProtocol

    @property
    def sandbox_id(self) -> str | None:
        return self._sandbox_id

    async def suspend(self) -> None:
        try:
            await self.shellctl_client.close()
        except Exception as exc:
            logger.warning("Failed to close shellctl client for sandbox %s: %s", self._sandbox_id, exc)
        try:
            await self.gateway.close()
        except Exception as exc:
            logger.warning("Failed to close gateway client: %s", exc)

    async def delete(self) -> None:
        try:
            await self.shellctl_client.close()
        except Exception as exc:
            logger.warning("Failed to close shellctl client for sandbox %s: %s", self._sandbox_id, exc)
        try:
            logger.info("Deleting enterprise sandbox via gateway: id=%s", self._sandbox_id)
            await self.gateway.delete_sandbox(self._sandbox_id)
            logger.info("Enterprise sandbox deleted: id=%s", self._sandbox_id)
        except ShellProviderError as exc:
            logger.warning("Failed to delete sandbox %s via gateway: %s", self._sandbox_id, exc)
        try:
            await self.gateway.close()
        except Exception as exc:
            logger.warning("Failed to close gateway client: %s", exc)


@dataclass(slots=True)
class EnterpriseShellProvider(ShellProviderProtocol):
    """Provisions enterprise sandboxes via the gateway, connects via shellctl.

    Lifecycle:
        1. ``create()`` calls the gateway to provision a new sandbox pod.
        2. ``attach(sandbox_id)`` builds a shellctl client pointed at the
           gateway's ``/proxy/{sandboxId}`` route for an *existing* sandbox,
           without provisioning a new one.
        3. Both return an ``EnterpriseResource`` with shellctl-backed
           command/file adapters.
        4. ``suspend()`` on the resource closes the shellctl and gateway
           clients but leaves the sandbox pod alive.
        5. ``delete()`` on the resource closes clients and deletes the
           sandbox via the gateway.
    """

    gateway_endpoint: str
    auth_token: str
    tenant_id: str | None = None
    template: str | None = None

    async def create(self) -> EnterpriseResource:
        gateway = EnterpriseGatewayClient(endpoint=self.gateway_endpoint, auth_token=self.auth_token)
        try:
            logger.info("Creating enterprise sandbox via gateway %s", self.gateway_endpoint)
            reply = await gateway.create_sandbox(tenant_id=self.tenant_id, template=self.template)
            sandbox_id = reply["sandboxId"]
            logger.info("Enterprise sandbox created: id=%s status=%s", sandbox_id, reply.get("status"))
        except BaseException:
            await gateway.close()
            raise
        return self._build_resource(sandbox_id=sandbox_id, gateway=gateway)

    async def attach(self, sandbox_id: str) -> EnterpriseResource:
        gateway = EnterpriseGatewayClient(endpoint=self.gateway_endpoint, auth_token=self.auth_token)
        logger.info("Attaching to existing enterprise sandbox: id=%s", sandbox_id)
        resource = self._build_resource(sandbox_id=sandbox_id, gateway=gateway)
        # Verify the sandbox is alive by running a trivial command through the proxy.
        # If the sandbox has expired, the gateway returns a 404 with "sandbox_expired";
        # if the pod is already gone the gateway returns a 404 with reason "NOT_FOUND".
        # Both surface as a ShellProviderError from the shellctl client and mean the
        # sandbox must be re-created.
        try:
            await resource.commands.run("true", timeout=5.0)
        except ShellProviderError as exc:
            await resource.suspend()
            message = str(exc).lower()
            if "expired" in message or "not_found" in message:
                raise SandboxExpiredError(sandbox_id, cause=exc) from exc
            raise
        return resource

    def _build_resource(self, *, sandbox_id: str, gateway: EnterpriseGatewayClient) -> EnterpriseResource:
        proxy_base_url = f"{self.gateway_endpoint.rstrip('/')}/proxy/"
        headers: dict[str, str] = {"X-Sandbox-Id": sandbox_id}
        if self.auth_token:
            headers["X-Inner-Api-Key"] = self.auth_token
        proxy_http_client = httpx.AsyncClient(
            base_url=proxy_base_url,
            headers=headers,
            follow_redirects=True,
            timeout=httpx.Timeout(60.0),
            transport=httpx.AsyncHTTPTransport(retries=3),
        )

        from shell_session_manager.shellctl.client import ShellctlClient

        client: ShellctlClientProtocol = ShellctlClient(
            proxy_base_url,
            token=self.auth_token,
            client=proxy_http_client,
        )

        return EnterpriseResource(
            _sandbox_id=sandbox_id,
            gateway=gateway,
            shellctl_client=client,
            commands=ShellctlCommands(client=client),
            files=ShellctlFileTransfer(client=client),
        )


__all__ = [
    "EnterpriseGatewayClient",
    "EnterpriseResource",
    "EnterpriseShellProvider",
]
