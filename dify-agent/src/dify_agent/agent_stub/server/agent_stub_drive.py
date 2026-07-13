"""Server-side Dify API client for Agent Stub drive endpoints.

The Agent Stub drive API is an HTTP-only control plane over the existing Dify
agent drive inner APIs. Sandbox callers never send trusted tenant, agent, or
user ids directly; this module receives an authenticated ``AgentStubPrincipal``,
derives ``agent-<agent_id>`` from execution context, injects trusted identity
fields into the Dify inner request, and normalizes transport, HTTP, JSON, and
schema failures into ``AgentStubDriveRequestError`` for the route layer.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubDriveCommitRequest,
    AgentStubDriveCommitResponse,
    AgentStubDriveManifestResponse,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class AgentStubDriveRequestHandler(Protocol):
    """Trusted control-plane bridge from sandbox drive calls to Dify inner APIs."""

    async def get_manifest(
        self,
        *,
        principal: AgentStubPrincipal,
        prefix: str,
        include_download_url: bool,
    ) -> AgentStubDriveManifestResponse: ...

    async def commit(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubDriveCommitRequest,
    ) -> AgentStubDriveCommitResponse: ...


class AgentStubDriveRequestError(RuntimeError):
    """Raised when the Agent Stub cannot complete one drive control-plane call."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


@dataclass(slots=True)
class DifyApiAgentStubDriveRequestHandler:
    """Call Dify API inner drive endpoints on behalf of authenticated sandboxes.

    Manifest requests require ``tenant_id`` and ``agent_id`` from execution
    context and forward query parameters to
    ``/inner/api/drive/agent-<agent_id>/manifest``. Commit requests additionally
    require ``user_id`` and post a raw JSON payload to
    ``/inner/api/drive/agent-<agent_id>/commit``. Dify drive endpoints return
    raw ``{"items": [...]}`` payloads instead of plugin-style ``data`` envelopes,
    so this module validates the raw success payload directly.
    """

    inner_api_url: str
    inner_api_key: str
    timeout: httpx.Timeout | float = 30.0

    async def get_manifest(
        self,
        *,
        principal: AgentStubPrincipal,
        prefix: str,
        include_download_url: bool,
    ) -> AgentStubDriveManifestResponse:
        """Request one drive manifest from Dify's inner drive manifest endpoint."""
        execution_context = self._require_agent_context(principal.execution_context)
        payload = await self._get_inner_api(
            f"/inner/api/drive/{self._drive_ref(execution_context)}/manifest",
            {
                "tenant_id": execution_context.tenant_id,
                "prefix": prefix,
                "include_download_url": str(include_download_url).lower(),
            },
        )
        try:
            return AgentStubDriveManifestResponse.model_validate(payload)
        except ValidationError as exc:
            raise AgentStubDriveRequestError(502, "Dify API drive manifest response is invalid") from exc

    async def commit(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubDriveCommitRequest,
    ) -> AgentStubDriveCommitResponse:
        """Commit one drive batch through Dify's inner drive commit endpoint."""
        execution_context = self._require_user_context(self._require_agent_context(principal.execution_context))
        payload = await self._post_inner_api(
            f"/inner/api/drive/{self._drive_ref(execution_context)}/commit",
            {
                "tenant_id": execution_context.tenant_id,
                "user_id": execution_context.user_id,
                "items": [item.model_dump(mode="json", exclude_none=True) for item in request.items],
            },
        )
        try:
            return AgentStubDriveCommitResponse.model_validate(payload)
        except ValidationError as exc:
            raise AgentStubDriveRequestError(502, "Dify API drive commit response is invalid") from exc

    def _require_agent_context(
        self, execution_context: DifyExecutionContextLayerConfig
    ) -> DifyExecutionContextLayerConfig:
        if execution_context.agent_id is None:
            raise AgentStubDriveRequestError(400, "execution context agent_id is required for drive operations")
        return execution_context

    def _require_user_context(
        self, execution_context: DifyExecutionContextLayerConfig
    ) -> DifyExecutionContextLayerConfig:
        if execution_context.user_id is None:
            raise AgentStubDriveRequestError(400, "execution context user_id is required for drive commit")
        return execution_context

    @staticmethod
    def _drive_ref(execution_context: DifyExecutionContextLayerConfig) -> str:
        agent_id = execution_context.agent_id
        if agent_id is None:
            raise AgentStubDriveRequestError(400, "execution context agent_id is required for drive operations")
        return f"agent-{agent_id}"

    async def _get_inner_api(self, path: str, params: Mapping[str, str]) -> object:
        url = f"{self.inner_api_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, trust_env=False) as client:
            try:
                response = await client.get(
                    url,
                    params=dict(params),
                    headers={"X-Inner-Api-Key": self.inner_api_key},
                )
            except httpx.TimeoutException as exc:
                raise AgentStubDriveRequestError(504, "Dify API drive request timed out") from exc
            except httpx.RequestError as exc:
                raise AgentStubDriveRequestError(502, f"Dify API drive request failed: {exc}") from exc
        return self._normalize_payload(response)

    async def _post_inner_api(self, path: str, payload: Mapping[str, Any]) -> object:
        url = f"{self.inner_api_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, trust_env=False) as client:
            try:
                response = await client.post(
                    url,
                    json=dict(payload),
                    headers={"X-Inner-Api-Key": self.inner_api_key},
                )
            except httpx.TimeoutException as exc:
                raise AgentStubDriveRequestError(504, "Dify API drive request timed out") from exc
            except httpx.RequestError as exc:
                raise AgentStubDriveRequestError(502, f"Dify API drive request failed: {exc}") from exc
        return self._normalize_payload(response)

    def _normalize_payload(self, response: httpx.Response) -> object:
        raw_payload = self._parse_json(response)
        if response.is_error:
            detail = raw_payload.get("detail", raw_payload) if isinstance(raw_payload, dict) else raw_payload
            raise AgentStubDriveRequestError(response.status_code, detail)
        return raw_payload

    @staticmethod
    def _parse_json(response: httpx.Response) -> object:
        try:
            return response.json()
        except ValueError as exc:
            raise AgentStubDriveRequestError(502, "Dify API drive request returned invalid JSON") from exc


__all__ = [
    "AgentStubDriveRequestError",
    "AgentStubDriveRequestHandler",
    "DifyApiAgentStubDriveRequestHandler",
]
