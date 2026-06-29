"""Server-side Dify API client for Agent Stub config endpoints.

Config requests are scoped entirely by the signed execution context carried in
the Agent Stub token. Tenant, agent, user, and config-version identifiers come
only from that trusted context; sandbox request bodies contribute only mutable
content such as asset names, env text, and note text.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigManifestResponse,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class AgentStubConfigRequestHandler(Protocol):
    async def manifest(self, *, principal: AgentStubPrincipal) -> AgentStubConfigManifestResponse: ...

    async def pull_skill(self, *, principal: AgentStubPrincipal, name: str) -> bytes: ...

    async def inspect_skill(self, *, principal: AgentStubPrincipal, name: str) -> dict[str, object]: ...

    async def pull_file(self, *, principal: AgentStubPrincipal, name: str) -> bytes: ...

    async def push(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubConfigPushRequest,
    ) -> AgentStubConfigPushResponse: ...

    async def update_env(self, *, principal: AgentStubPrincipal, env_text: str) -> dict[str, object]: ...

    async def update_note(self, *, principal: AgentStubPrincipal, note: str) -> dict[str, object]: ...


class AgentStubConfigRequestError(RuntimeError):
    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


@dataclass(slots=True)
class DifyApiAgentStubConfigRequestHandler:
    """Call Dify API inner config endpoints on behalf of authenticated sandboxes.

    The sandbox never chooses tenant, agent, user, or config-version scope
    directly. Those routing fields are derived from the signed execution
    context, while request payloads only carry mutable config content.
    """

    inner_api_url: str
    inner_api_key: str
    timeout: httpx.Timeout | float = 30.0

    async def manifest(self, *, principal: AgentStubPrincipal) -> AgentStubConfigManifestResponse:
        execution_context = self._require_config_context(principal.execution_context)
        payload = await self._get_inner_api_json(
            f"/inner/api/agent-config/{execution_context.agent_id}/manifest",
            self._config_query_params(execution_context),
        )
        try:
            return AgentStubConfigManifestResponse.model_validate(payload)
        except ValidationError as exc:
            raise AgentStubConfigRequestError(502, "Dify API config manifest response is invalid") from exc

    async def pull_skill(self, *, principal: AgentStubPrincipal, name: str) -> bytes:
        execution_context = self._require_config_context(principal.execution_context)
        return await self._get_inner_api_bytes(
            f"/inner/api/agent-config/{execution_context.agent_id}/skills/{name}/pull",
            self._config_query_params(execution_context),
        )

    async def inspect_skill(self, *, principal: AgentStubPrincipal, name: str) -> dict[str, object]:
        execution_context = self._require_config_context(principal.execution_context)
        payload = await self._get_inner_api_json(
            f"/inner/api/agent-config/{execution_context.agent_id}/skills/{name}/inspect",
            self._config_query_params(execution_context),
        )
        if not isinstance(payload, dict):
            raise AgentStubConfigRequestError(502, "Dify API config skill inspect response is invalid")
        return payload

    async def pull_file(self, *, principal: AgentStubPrincipal, name: str) -> bytes:
        execution_context = self._require_config_context(principal.execution_context)
        return await self._get_inner_api_bytes(
            f"/inner/api/agent-config/{execution_context.agent_id}/files/{name}/pull",
            self._config_query_params(execution_context),
        )

    async def push(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubConfigPushRequest,
    ) -> AgentStubConfigPushResponse:
        execution_context = self._require_user_context(self._require_config_context(principal.execution_context))
        payload = await self._post_inner_api_json(
            f"/inner/api/agent-config/{execution_context.agent_id}/push",
            {
                "tenant_id": execution_context.tenant_id,
                "user_id": execution_context.user_id,
                "config_version_id": execution_context.agent_config_version_id,
                "config_version_kind": execution_context.agent_config_version_kind,
                **request.model_dump(mode="json", exclude_none=True),
            },
        )
        try:
            return AgentStubConfigPushResponse.model_validate(payload)
        except ValidationError as exc:
            raise AgentStubConfigRequestError(502, "Dify API config push response is invalid") from exc

    async def update_env(self, *, principal: AgentStubPrincipal, env_text: str) -> dict[str, object]:
        execution_context = self._require_user_context(self._require_config_context(principal.execution_context))
        payload = await self._patch_inner_api_json(
            f"/inner/api/agent-config/{execution_context.agent_id}/env",
            {
                "tenant_id": execution_context.tenant_id,
                "user_id": execution_context.user_id,
                "config_version_id": execution_context.agent_config_version_id,
                "config_version_kind": execution_context.agent_config_version_kind,
                "env_text": env_text,
            },
        )
        if not isinstance(payload, dict):
            raise AgentStubConfigRequestError(502, "Dify API config env response is invalid")
        return payload

    async def update_note(self, *, principal: AgentStubPrincipal, note: str) -> dict[str, object]:
        execution_context = self._require_user_context(self._require_config_context(principal.execution_context))
        payload = await self._put_inner_api_json(
            f"/inner/api/agent-config/{execution_context.agent_id}/note",
            {
                "tenant_id": execution_context.tenant_id,
                "user_id": execution_context.user_id,
                "config_version_id": execution_context.agent_config_version_id,
                "config_version_kind": execution_context.agent_config_version_kind,
                "note": note,
            },
        )
        if not isinstance(payload, dict):
            raise AgentStubConfigRequestError(502, "Dify API config note response is invalid")
        return payload

    @staticmethod
    def _require_config_context(execution_context: DifyExecutionContextLayerConfig) -> DifyExecutionContextLayerConfig:
        if execution_context.agent_id is None:
            raise AgentStubConfigRequestError(400, "execution context agent_id is required for config operations")
        if execution_context.agent_config_version_id is None:
            raise AgentStubConfigRequestError(400, "execution context agent_config_version_id is required")
        if execution_context.agent_config_version_kind is None:
            raise AgentStubConfigRequestError(400, "execution context agent_config_version_kind is required")
        return execution_context

    @staticmethod
    def _require_user_context(execution_context: DifyExecutionContextLayerConfig) -> DifyExecutionContextLayerConfig:
        if execution_context.user_id is None:
            raise AgentStubConfigRequestError(400, "execution context user_id is required for config write operations")
        return execution_context

    @staticmethod
    def _config_query_params(execution_context: DifyExecutionContextLayerConfig) -> dict[str, str]:
        return {
            "tenant_id": execution_context.tenant_id,
            "config_version_id": execution_context.agent_config_version_id or "",
            "config_version_kind": execution_context.agent_config_version_kind or "",
        }

    async def _get_inner_api_json(self, path: str, params: Mapping[str, str]) -> object:
        response = await self._request("GET", path, params=dict(params))
        return self._normalize_json_payload(
            response, invalid_json_detail="Dify API config request returned invalid JSON"
        )

    async def _get_inner_api_bytes(self, path: str, params: Mapping[str, str]) -> bytes:
        response = await self._request("GET", path, params=dict(params))
        if response.is_error:
            detail = self._normalize_json_payload(
                response,
                invalid_json_detail="Dify API config request returned invalid JSON",
            )
            raise AgentStubConfigRequestError(
                response.status_code, detail.get("detail", detail) if isinstance(detail, dict) else detail
            )
        return response.content

    async def _post_inner_api_json(self, path: str, payload: Mapping[str, Any]) -> object:
        response = await self._request("POST", path, json=dict(payload))
        return self._normalize_json_payload(
            response, invalid_json_detail="Dify API config request returned invalid JSON"
        )

    async def _patch_inner_api_json(self, path: str, payload: Mapping[str, Any]) -> object:
        response = await self._request("PATCH", path, json=dict(payload))
        return self._normalize_json_payload(
            response, invalid_json_detail="Dify API config request returned invalid JSON"
        )

    async def _put_inner_api_json(self, path: str, payload: Mapping[str, Any]) -> object:
        response = await self._request("PUT", path, json=dict(payload))
        return self._normalize_json_payload(
            response, invalid_json_detail="Dify API config request returned invalid JSON"
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        json: Mapping[str, Any] | None = None,
    ) -> httpx.Response:
        url = f"{self.inner_api_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, trust_env=False) as client:
            try:
                return await client.request(
                    method,
                    url,
                    params=dict(params or {}),
                    json=dict(json or {}) if json is not None else None,
                    headers={"X-Inner-Api-Key": self.inner_api_key},
                )
            except httpx.TimeoutException as exc:
                raise AgentStubConfigRequestError(504, "Dify API config request timed out") from exc
            except httpx.RequestError as exc:
                raise AgentStubConfigRequestError(502, f"Dify API config request failed: {exc}") from exc

    @staticmethod
    def _normalize_json_payload(response: httpx.Response, *, invalid_json_detail: str) -> object:
        try:
            payload = response.json()
        except ValueError as exc:
            raise AgentStubConfigRequestError(502, invalid_json_detail) from exc
        if response.is_error:
            detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
            raise AgentStubConfigRequestError(response.status_code, detail)
        return payload


__all__ = [
    "AgentStubConfigRequestError",
    "AgentStubConfigRequestHandler",
    "DifyApiAgentStubConfigRequestHandler",
]
