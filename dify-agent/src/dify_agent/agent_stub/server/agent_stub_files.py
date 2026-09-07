"""Server-side Dify API client for Agent Stub file endpoints.

The Agent Stub serves only control-plane file endpoints. This module is
the trusted bridge from authenticated stub requests into Dify's inner file
request APIs. Callers pass a decoded ``AgentStubPrincipal`` and a validated
public Agent Stub request DTO; this module injects the execution-context tenant
and user fields that sandbox code is not allowed to forge, calls the matching
Dify inner API endpoint, and normalizes all expected failures into
``AgentStubFileRequestError`` with HTTP-oriented ``status_code`` and ``detail``
values that route handlers can map directly into responses.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import posixpath
from typing import Any, Protocol
from urllib.parse import unquote, urlsplit

import httpx
from pydantic import ValidationError

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class AgentStubFileRequestHandler(Protocol):
    """Trusted control-plane bridge from sandbox calls to Dify API inner APIs.

    Implementations are expected to accept authenticated execution context from
    the stub token principal, inject the required tenant/user metadata into the
    Dify inner API request, and raise ``AgentStubFileRequestError`` when the
    downstream call cannot produce a valid control-plane response.
    """

    async def create_upload_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileUploadRequest,
    ) -> AgentStubFileUploadResponse: ...

    async def create_download_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileDownloadRequest,
    ) -> AgentStubFileDownloadResponse: ...


class AgentStubFileRequestError(RuntimeError):
    """Raised when the Agent Stub cannot complete a file control-plane call.

    ``status_code`` and ``detail`` are shaped for direct translation into HTTP
    responses by FastAPI route handlers, so downstream callers should not need a
    second error-mapping layer for Dify file-request failures.
    """

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


def bind_sandbox_file_uri(*, sandbox_files_base_url: str, uri: str) -> str:
    """Bind one validated origin-free Dify file URI to the Sandbox audience."""

    if not is_safe_dify_file_uri(uri):
        raise ValueError("Dify API returned an unsafe Dify file URI")
    return f"{sandbox_files_base_url.rstrip('/')}{uri}"


def is_safe_dify_file_uri(value: str) -> bool:
    """Return whether a URI stays within Dify's signed ``/files/*`` data plane."""

    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.fragment or value.startswith("//"):
        return False

    decoded_path = parsed.path
    for _ in range(2):
        decoded_path = unquote(decoded_path)
    if "\\" in decoded_path:
        return False
    normalized_path = posixpath.normpath(decoded_path)
    return decoded_path.startswith("/files/") and normalized_path.startswith("/files/")


@dataclass(slots=True)
class DifyApiAgentStubFileRequestHandler:
    """Call Dify API inner file request endpoints on behalf of the sandbox.

    The upload path calls ``/inner/api/agent/files/upload-request`` and injects the
    authenticated execution context's ``tenant_id``, ``user_id``, ``user_from``, and optional
    ``conversation_id`` along with the requested filename, mimetype, and configured upload-size
    limit. The download path calls
    ``/inner/api/agent/files/download-request`` and injects ``tenant_id``,
    ``user_id``, ``user_from``, and ``invoke_from`` plus the validated public
    file mapping.

    ``user_id`` is mandatory for both operations. Missing user context is
    rejected before any network call with ``AgentStubFileRequestError(400, ...)``.
    Timeouts, transport failures, non-2xx responses, invalid JSON, and invalid
    success schemas are all normalized into
    ``AgentStubFileRequestError`` so the stub routes can preserve a stable HTTP
    contract without exposing raw ``httpx`` or Pydantic exceptions.
    """

    inner_api_url: str
    inner_api_key: str
    sandbox_files_base_url: str
    max_upload_size_bytes: int
    timeout: httpx.Timeout | float = 30.0

    async def create_upload_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileUploadRequest,
    ) -> AgentStubFileUploadResponse:
        """Request one signed upload URL from Dify's inner upload endpoint.

        The request payload is derived from authenticated execution context and
        the public upload DTO. ``principal.execution_context.user_id`` must be
        present; otherwise the method raises ``AgentStubFileRequestError`` with
        status ``400`` before contacting Dify.

        Raises:
            AgentStubFileRequestError: when user context is incomplete, the
                inner API times out or fails, the response is non-2xx, or the
                success payload does not contain a valid ``upload_uri``.
        """
        execution_context = self._require_user_context(principal.execution_context)
        payload = {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "user_from": execution_context.user_from,
            "filename": request.filename,
            "mimetype": request.mimetype,
            "conversation_id": execution_context.conversation_id,
            "max_size": self.max_upload_size_bytes,
        }
        data = await self._post_inner_api("/inner/api/agent/files/upload-request", payload)
        upload_uri = data.get("upload_uri")
        if not isinstance(upload_uri, str) or not upload_uri:
            raise AgentStubFileRequestError(502, "Dify API upload request response is missing upload_uri")
        return AgentStubFileUploadResponse(
            upload_url=self._bind_sandbox_files_base_url(upload_uri),
        )

    async def create_download_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileDownloadRequest,
    ) -> AgentStubFileDownloadResponse:
        """Request one signed download URL from Dify's inner download endpoint.

        The request payload combines authenticated execution-context identity
        fields with the validated public file mapping. ``user_id`` is required
        and missing user context is rejected locally with
        ``AgentStubFileRequestError(400, ...)``.

        Raises:
            AgentStubFileRequestError: when user context is incomplete, the
                inner API times out or fails, the response is non-2xx, the
                success payload does not contain safe download metadata.
        """
        execution_context = self._require_user_context(principal.execution_context)
        file_mapping = request.file
        if file_mapping is None:
            raise AgentStubFileRequestError(400, "file mapping is required for file download requests")
        payload: dict[str, object] = {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "user_from": execution_context.user_from,
            "invoke_from": execution_context.invoke_from,
            "file": file_mapping.model_dump(mode="json", exclude_none=True),
        }
        payload["for_frontend"] = request.for_frontend
        data = await self._post_inner_api("/inner/api/agent/files/download-request", payload)
        download_uri = data.get("download_uri")
        if not isinstance(download_uri, str) or not download_uri:
            raise AgentStubFileRequestError(502, "Dify API download request response is missing download_uri")
        download_url = self._resolve_download_url(
            file_mapping=file_mapping,
            for_frontend=request.for_frontend,
            download_uri=download_uri,
        )
        try:
            return AgentStubFileDownloadResponse.model_validate({**data, "download_url": download_url})
        except ValidationError as exc:
            raise AgentStubFileRequestError(502, "Dify API download request response is invalid") from exc

    def _require_user_context(
        self, execution_context: DifyExecutionContextLayerConfig
    ) -> DifyExecutionContextLayerConfig:
        if execution_context.user_id is None:
            raise AgentStubFileRequestError(400, "execution context user_id is required for file operations")
        return execution_context

    async def _post_inner_api(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self.inner_api_url.rstrip('/')}{path}"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, trust_env=False) as client:
            try:
                response = await client.post(
                    url,
                    json=dict(payload),
                    headers={"X-Inner-Api-Key": self.inner_api_key},
                )
            except httpx.TimeoutException as exc:
                raise AgentStubFileRequestError(504, "Dify API file request timed out") from exc
            except httpx.RequestError as exc:
                raise AgentStubFileRequestError(502, f"Dify API file request failed: {exc}") from exc

        raw_payload = self._parse_json(response)
        if response.is_error:
            detail = raw_payload.get("detail", raw_payload) if isinstance(raw_payload, dict) else raw_payload
            raise AgentStubFileRequestError(response.status_code, detail)
        if not isinstance(raw_payload, dict):
            raise AgentStubFileRequestError(502, "Dify API file request response is invalid")
        return raw_payload

    def _resolve_download_url(
        self,
        *,
        file_mapping: AgentStubFileMapping,
        for_frontend: bool,
        download_uri: str,
    ) -> str:
        if file_mapping.transfer_method == "remote_url":
            if self._is_absolute_http_url(download_uri):
                return download_uri
            raise AgentStubFileRequestError(502, "Dify API returned an invalid remote download URL")

        if for_frontend:
            if self._is_absolute_http_url(download_uri) or is_safe_dify_file_uri(download_uri):
                return download_uri
            raise AgentStubFileRequestError(502, "Dify API returned an unsafe frontend download URI")

        return self._bind_sandbox_files_base_url(download_uri)

    def _bind_sandbox_files_base_url(self, uri: str) -> str:
        try:
            return bind_sandbox_file_uri(sandbox_files_base_url=self.sandbox_files_base_url, uri=uri)
        except ValueError as exc:
            raise AgentStubFileRequestError(502, str(exc)) from exc

    @staticmethod
    def _is_absolute_http_url(value: str) -> bool:
        parsed = urlsplit(value)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    @staticmethod
    def _parse_json(response: httpx.Response) -> object:
        try:
            return response.json()
        except ValueError as exc:
            raise AgentStubFileRequestError(502, "Dify API file request returned invalid JSON") from exc


__all__ = [
    "AgentStubFileRequestError",
    "AgentStubFileRequestHandler",
    "DifyApiAgentStubFileRequestHandler",
    "bind_sandbox_file_uri",
    "is_safe_dify_file_uri",
]
