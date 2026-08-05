"""Async client for the Dify API inner knowledge retrieval endpoint.

This wrapper owns only request/response mapping and error normalization for
``POST /inner/api/knowledge/retrieve``. The shared ``httpx.AsyncClient`` is
supplied by the FastAPI lifespan/runtime and must stay open for the caller.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import ClassVar

import httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from dify_agent.layers.knowledge.configs import (
    DifyKnowledgeMetadataFilteringConfig,
    DifyKnowledgeRetrievalConfig,
)


class DifyKnowledgeBaseClientError(RuntimeError):
    """Raised when the inner knowledge retrieval HTTP boundary fails."""

    status_code: int | None
    error_code: str | None
    retryable: bool

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        retryable: bool,
    ) -> None:
        self.status_code = status_code
        self.error_code = error_code
        self.retryable = retryable
        super().__init__(message)


class _DifyKnowledgeCaller(BaseModel):
    tenant_id: str
    user_id: str
    app_id: str
    user_from: str
    invoke_from: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class _DifyKnowledgeRetrieveRequest(BaseModel):
    caller: _DifyKnowledgeCaller
    dataset_ids: list[str]
    query: str
    retrieval: dict[str, JsonValue]
    metadata_filtering: dict[str, JsonValue]
    attachment_ids: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeResultMetadata(BaseModel):
    source: str | None = Field(default=None, alias="_source")
    dataset_id: str | None = None
    dataset_name: str | None = None
    document_id: str | None = None
    document_name: str | None = None
    score: float | int | str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow", populate_by_name=True)


class DifyKnowledgeResult(BaseModel):
    metadata: DifyKnowledgeResultMetadata
    title: str | None = None
    files: list[JsonValue] | None = None
    content: str | None = None
    summary: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeRetrieveResponse(BaseModel):
    results: list[DifyKnowledgeResult]
    usage: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True)
class DifyKnowledgeBaseClient:
    """Boundary client for the Dify API inner knowledge retrieval endpoint."""

    base_url: str
    api_key: str = field(repr=False)
    http_client: httpx.AsyncClient = field(repr=False)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    async def retrieve(
        self,
        *,
        tenant_id: str,
        user_id: str,
        app_id: str,
        user_from: str,
        invoke_from: str,
        dataset_ids: list[str],
        query: str,
        retrieval: DifyKnowledgeRetrievalConfig,
        metadata_filtering: DifyKnowledgeMetadataFilteringConfig,
    ) -> DifyKnowledgeRetrieveResponse:
        """Call the inner API and return parsed retrieval results.

        Raises:
            DifyKnowledgeBaseClientError: For HTTP, transport, or response-shape
                failures. Only ``429``, ``502``, and transport/timeout failures
                are marked retryable because the model may continue gracefully in
                those temporary-unavailable cases.
        """
        request_payload = _DifyKnowledgeRetrieveRequest(
            caller=_DifyKnowledgeCaller(
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                user_from=user_from,
                invoke_from=invoke_from,
            ),
            dataset_ids=dataset_ids,
            query=query,
            retrieval=retrieval.to_request_payload(),
            metadata_filtering=metadata_filtering.to_request_payload(),
        )

        try:
            response = await self.http_client.post(
                f"{self.base_url}/inner/api/knowledge/retrieve",
                headers={
                    "X-Inner-Api-Key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=request_payload.model_dump(mode="json", by_alias=True),
            )
        except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
            raise DifyKnowledgeBaseClientError(
                f"Knowledge base search is misconfigured: {exc}",
                retryable=False,
            ) from exc
        except httpx.TimeoutException as exc:
            raise DifyKnowledgeBaseClientError(
                "Knowledge base search timed out.",
                retryable=True,
            ) from exc
        except httpx.RequestError as exc:
            raise DifyKnowledgeBaseClientError(
                f"Knowledge base search request failed: {exc}",
                retryable=True,
            ) from exc

        if response.status_code >= 400:
            raise _build_http_error(response)

        try:
            return DifyKnowledgeRetrieveResponse.model_validate_json(response.text)
        except ValidationError as exc:
            raise DifyKnowledgeBaseClientError(
                "Invalid knowledge retrieval response from Dify API.",
                status_code=response.status_code,
                error_code="invalid_response",
                retryable=False,
            ) from exc


def _build_http_error(response: httpx.Response) -> DifyKnowledgeBaseClientError:
    detail = _decode_error_detail(response)
    retryable = response.status_code in {429, 502}
    error_code = detail["error_code"]
    message = detail["message"] or f"HTTP {response.status_code}"
    if error_code:
        message = f"Knowledge base search failed with HTTP {response.status_code} ({error_code}): {message}"
    else:
        message = f"Knowledge base search failed with HTTP {response.status_code}: {message}"
    return DifyKnowledgeBaseClientError(
        message,
        status_code=response.status_code,
        error_code=error_code,
        retryable=retryable,
    )


def _decode_error_detail(response: httpx.Response) -> dict[str, str | None]:
    raw_body = response.text
    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, dict):
        error_code = payload.get("code")
        message = payload.get("message")
        return {
            "error_code": error_code if isinstance(error_code, str) else None,
            "message": message if isinstance(message, str) and message else raw_body or f"HTTP {response.status_code}",
        }

    return {"error_code": None, "message": raw_body or f"HTTP {response.status_code}"}


__all__ = [
    "DifyKnowledgeBaseClient",
    "DifyKnowledgeBaseClientError",
    "DifyKnowledgeResult",
    "DifyKnowledgeResultMetadata",
    "DifyKnowledgeRetrieveResponse",
]
