"""Server-side Dify API client for shell back proxy file endpoints."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.back_proxy import (
    BackProxyFileDownloadRequest,
    BackProxyFileDownloadResponse,
    BackProxyFileUploadRequest,
    BackProxyFileUploadResponse,
)
from dify_agent.server.tokens.back_proxy import BackProxyPrincipal


class BackProxyFileRequestHandler(Protocol):
    """Trusted control-plane bridge from sandbox calls to Dify API inner APIs."""

    async def create_upload_request(
        self,
        *,
        principal: BackProxyPrincipal,
        request: BackProxyFileUploadRequest,
    ) -> BackProxyFileUploadResponse: ...

    async def create_download_request(
        self,
        *,
        principal: BackProxyPrincipal,
        request: BackProxyFileDownloadRequest,
    ) -> BackProxyFileDownloadResponse: ...


class BackProxyFileRequestError(RuntimeError):
    """Raised when the back proxy cannot complete a file control-plane call."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


class _BackwardsInvocationEnvelope(BaseModel):
    """Minimal parser for Dify API plugin-style inner API envelopes."""

    data: object | None = None
    error: str | None = None

    model_config = ConfigDict(extra="ignore")


@dataclass(slots=True)
class DifyApiBackProxyFileRequestHandler:
    """Call Dify API inner file request endpoints on behalf of the sandbox."""

    dify_api_base_url: str
    dify_api_inner_api_key: str
    timeout: httpx.Timeout | float = 30.0

    async def create_upload_request(
        self,
        *,
        principal: BackProxyPrincipal,
        request: BackProxyFileUploadRequest,
    ) -> BackProxyFileUploadResponse:
        execution_context = self._require_user_context(principal.execution_context)
        payload = {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "filename": request.filename,
            "mimetype": request.mimetype,
        }
        data = await self._post_inner_api("/inner/api/upload/file/request", payload)
        upload_url = data.get("url")
        if not isinstance(upload_url, str) or not upload_url:
            raise BackProxyFileRequestError(502, "Dify API upload request response is missing url")
        return BackProxyFileUploadResponse(upload_url=upload_url)

    async def create_download_request(
        self,
        *,
        principal: BackProxyPrincipal,
        request: BackProxyFileDownloadRequest,
    ) -> BackProxyFileDownloadResponse:
        execution_context = self._require_user_context(principal.execution_context)
        payload = {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "user_from": execution_context.user_from,
            "invoke_from": execution_context.invoke_from,
            "file": request.file.model_dump(mode="json", exclude_none=True),
        }
        data = await self._post_inner_api("/inner/api/download/file/request", payload)
        try:
            return BackProxyFileDownloadResponse.model_validate(data)
        except ValidationError as exc:
            raise BackProxyFileRequestError(502, "Dify API download request response is invalid") from exc

    def _require_user_context(self, execution_context: DifyExecutionContextLayerConfig) -> DifyExecutionContextLayerConfig:
        if execution_context.user_id is None:
            raise BackProxyFileRequestError(400, "execution context user_id is required for file operations")
        return execution_context

    async def _post_inner_api(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self.dify_api_base_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, trust_env=False) as client:
            try:
                response = await client.post(
                    url,
                    json=dict(payload),
                    headers={"X-Inner-Api-Key": self.dify_api_inner_api_key},
                )
            except httpx.TimeoutException as exc:
                raise BackProxyFileRequestError(504, "Dify API file request timed out") from exc
            except httpx.RequestError as exc:
                raise BackProxyFileRequestError(502, f"Dify API file request failed: {exc}") from exc

        raw_payload = self._parse_json(response)
        if response.is_error:
            detail = raw_payload.get("detail", raw_payload) if isinstance(raw_payload, dict) else raw_payload
            raise BackProxyFileRequestError(response.status_code, detail)
        try:
            envelope = _BackwardsInvocationEnvelope.model_validate(raw_payload)
        except ValidationError as exc:
            raise BackProxyFileRequestError(502, "Dify API file request response is invalid") from exc
        if envelope.error:
            raise BackProxyFileRequestError(400, envelope.error)
        if not isinstance(envelope.data, dict):
            raise BackProxyFileRequestError(502, "Dify API file request response is missing data")
        return dict(envelope.data)

    @staticmethod
    def _parse_json(response: httpx.Response) -> object:
        try:
            return response.json()
        except ValueError as exc:
            raise BackProxyFileRequestError(502, "Dify API file request returned invalid JSON") from exc


__all__ = [
    "BackProxyFileRequestError",
    "BackProxyFileRequestHandler",
    "DifyApiBackProxyFileRequestHandler",
]
