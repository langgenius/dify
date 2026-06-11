"""API-side client for the agent backend's ``/sandbox`` file endpoints.

The API backend addresses sandbox sessions by ``SandboxLocator`` rather than by a
raw shell session id. This client preserves that structured request body and
normalizes transport/HTTP failures into the API boundary's Agent backend errors.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from dify_agent.protocol import (
    SandboxListRequest,
    SandboxListResponse,
    SandboxLocator,
    SandboxReadRequest,
    SandboxReadResponse,
    SandboxUploadRequest,
    SandboxUploadResponse,
)

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError

_DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(slots=True)
class SandboxBackendClient:
    """Synchronous proxy to the agent backend sandbox file endpoints."""

    base_url: str
    timeout: float = _DEFAULT_TIMEOUT_SECONDS
    transport: httpx.BaseTransport | None = None

    def list_files(self, *, locator: SandboxLocator, path: str) -> SandboxListResponse:
        data = self._post("/sandbox/files/list", SandboxListRequest(locator=locator, path=path))
        return SandboxListResponse.model_validate(data)

    def read_file(self, *, locator: SandboxLocator, path: str, max_bytes: int = 262144) -> SandboxReadResponse:
        data = self._post("/sandbox/files/read", SandboxReadRequest(locator=locator, path=path, max_bytes=max_bytes))
        return SandboxReadResponse.model_validate(data)

    def upload_file(self, *, locator: SandboxLocator, path: str) -> SandboxUploadResponse:
        data = self._post("/sandbox/files/upload", SandboxUploadRequest(locator=locator, path=path))
        return SandboxUploadResponse.model_validate(data)

    def _post(self, route: str, payload: SandboxListRequest | SandboxReadRequest | SandboxUploadRequest) -> dict[str, object]:
        url = f"{self.base_url.rstrip('/')}{route}"
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport, trust_env=False) as client:
                response = client.post(url, json=payload.model_dump(mode="json"))
        except httpx.HTTPError as exc:
            raise AgentBackendTransportError(f"failed to reach agent backend sandbox endpoint: {exc}") from exc
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            raise AgentBackendHTTPError(
                f"agent backend sandbox request failed ({response.status_code})",
                status_code=response.status_code,
                detail=detail,
            )
        try:
            body = response.json()
        except ValueError as exc:
            raise AgentBackendHTTPError(
                "agent backend sandbox response was not valid JSON",
                status_code=502,
                detail=response.text,
            ) from exc
        if not isinstance(body, dict):
            raise AgentBackendHTTPError(
                "agent backend sandbox response was not an object",
                status_code=502,
                detail=body,
            )
        return body


__all__ = ["SandboxBackendClient"]
