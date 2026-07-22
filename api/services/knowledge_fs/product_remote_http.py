"""Capability-only HTTP transport for manifest-approved JSON and bounded binary calls."""

from __future__ import annotations

import json
from http import HTTPStatus
from urllib.parse import urlencode

import httpx
from pydantic import JsonValue, TypeAdapter, ValidationError

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.knowledge_fs.product_dto import (
    KnowledgeFSBatchTechnicalSummaryResponse,
    KnowledgeFSTechnicalSummary,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
)

_JSON_ADAPTER: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_MAX_BATCH_SUMMARIES = 100


class HTTPKnowledgeFSProductRemoteClient:
    """Build outbound headers from trusted capability input; browser headers never enter this class."""

    def __init__(self, *, base_url: str, timeout_seconds: float, max_response_bytes: int = 4 * 1024 * 1024) -> None:
        self._base_url = base_url
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes

    def batch_space_summaries(
        self,
        *,
        namespace_id: str,
        knowledge_space_ids: tuple[str, ...],
        capability_token: str,
        trace_id: str,
    ) -> dict[str, KnowledgeFSTechnicalSummary]:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS["batchSpaceSummaries"]
        if not is_product_operation_ready("batchSpaceSummaries") or operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS batch summary operation is unavailable")
        if (
            not namespace_id
            or not capability_token
            or not trace_id
            or not knowledge_space_ids
            or len(knowledge_space_ids) > _MAX_BATCH_SUMMARIES
            or any(not knowledge_space_id for knowledge_space_id in knowledge_space_ids)
            or len(set(knowledge_space_ids)) != len(knowledge_space_ids)
        ):
            raise KnowledgeFSProductRemoteError("KnowledgeFS batch request binding is invalid")
        payload = self._request_json(
            method=operation.method,
            path=operation.kfs_path,
            capability_token=capability_token,
            trace_id=trace_id,
            payload={"knowledgeSpaceIds": list(knowledge_space_ids)},
            query=(),
            max_request_bytes=operation.max_request_bytes,
            max_response_bytes=operation.max_response_bytes,
        )
        try:
            response = KnowledgeFSBatchTechnicalSummaryResponse.model_validate(payload)
        except ValidationError as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS returned an invalid batch summary") from exc
        requested_ids = frozenset(knowledge_space_ids)
        summaries: dict[str, KnowledgeFSTechnicalSummary] = {}
        for summary in response.items:
            if summary.knowledge_space_id not in requested_ids or summary.knowledge_space_id in summaries:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an out-of-scope batch summary")
            summaries[summary.knowledge_space_id] = summary
        return summaries

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> JsonValue:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(request.operation_id)
        if operation is None or operation.transport != "json" or not is_product_operation_ready(request.operation_id):
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {request.operation_id}")
        if (
            request.method != operation.method
            or operation.kfs_path is None
            or not _matches_path(operation.kfs_path, request.path)
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS request does not match its operation manifest")
        if (
            not request.namespace_id
            or not request.knowledge_space_id
            or not request.capability_token
            or not request.trace_id
        ):
            raise KnowledgeFSProductRemoteError("KnowledgeFS request binding is incomplete")

        return self._request_json(
            method=request.method,
            path=request.path,
            capability_token=request.capability_token,
            trace_id=request.trace_id,
            payload=request.payload,
            query=request.query,
            extra_headers=request.headers,
            max_request_bytes=operation.max_request_bytes,
            max_response_bytes=operation.max_response_bytes,
        )

    def execute_binary(self, request: KnowledgeFSRemoteBinaryRequest) -> JsonValue:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(request.operation_id)
        if operation is None or operation.transport != "binary" or not is_product_operation_ready(request.operation_id):
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {request.operation_id}")
        if (
            request.method != operation.method
            or operation.kfs_path is None
            or not _matches_path(operation.kfs_path, request.path)
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS request does not match its operation manifest")
        if (
            not request.namespace_id
            or not request.knowledge_space_id
            or not request.capability_token
            or not request.trace_id
            or request.query != (("knowledgeSpaceId", request.knowledge_space_id),)
        ):
            raise KnowledgeFSProductRemoteError("KnowledgeFS binary request binding is incomplete")
        if not isinstance(request.body, bytes) or not request.body:
            raise KnowledgeFSProductRequestRejectedError(status_code=422)
        if len(request.body) > operation.max_request_bytes:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)
        response_limit = min(self._max_response_bytes, operation.max_response_bytes)
        if response_limit <= 0:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS operation response limit is unavailable")
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {request.capability_token}",
            "Content-Type": "application/octet-stream",
            "X-Trace-Id": request.trace_id,
        }
        try:
            upstream_url = httpx.URL(f"{self._base_url.rstrip('/')}/").join(request.path.lstrip("/"))
            response = ssrf_proxy.make_request(
                method=request.method,
                url=str(upstream_url),
                headers=headers,
                params=request.query,
                content=request.body,
                timeout=self._timeout_seconds,
                follow_redirects=False,
                max_retries=0,
                stream_response=True,
            )
            response = ssrf_proxy.buffer_response(response, max_response_bytes=response_limit)
        except (ssrf_proxy.ResponseLimitError, httpx.RequestError, ToolSSRFError) as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request failed") from exc
        try:
            if response.status_code == 409:
                raise KnowledgeFSProductRequestRejectedError(status_code=409)
            if response.status_code == 413:
                raise KnowledgeFSProductRequestRejectedError(status_code=413)
            if response.status_code == 422:
                raise KnowledgeFSProductRequestRejectedError(status_code=422)
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported media type")
            if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
                raise KnowledgeFSProductRemoteError(f"KnowledgeFS returned HTTP {response.status_code}")
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned invalid JSON") from exc
        finally:
            response.close()

    def _request_json(
        self,
        *,
        method: str,
        path: str,
        capability_token: str,
        trace_id: str,
        payload: JsonValue | None,
        query: tuple[tuple[str, str], ...],
        extra_headers: tuple[tuple[str, str], ...] = (),
        max_request_bytes: int,
        max_response_bytes: int,
    ) -> JsonValue:
        request_size = len(urlencode(query).encode("utf-8"))
        if payload is not None:
            try:
                request_size += len(
                    json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
                )
            except (TypeError, ValueError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS request payload is invalid") from exc
        if request_size > max_request_bytes:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request exceeds its operation byte limit")
        response_limit = min(self._max_response_bytes, max_response_bytes)
        if response_limit <= 0:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS operation response limit is unavailable")
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {capability_token}",
            "X-Trace-Id": trace_id,
        }
        for name, value in extra_headers:
            if name.lower() != "idempotency-key" or not 8 <= len(value.strip()) <= 255:
                raise KnowledgeFSProductRemoteError("KnowledgeFS request header binding is invalid")
            headers["Idempotency-Key"] = value.strip()
        request_kwargs: dict[str, object] = {
            "headers": headers,
            "params": query,
            "timeout": self._timeout_seconds,
            "follow_redirects": False,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
            request_kwargs["json"] = payload
        try:
            upstream_url = httpx.URL(f"{self._base_url.rstrip('/')}/").join(path.lstrip("/"))
            response = ssrf_proxy.make_request(
                method=method,
                url=str(upstream_url),
                max_retries=0,
                stream_response=True,
                **request_kwargs,
            )
            response = ssrf_proxy.buffer_response(response, max_response_bytes=response_limit)
        except (ssrf_proxy.ResponseLimitError, httpx.RequestError, ToolSSRFError) as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request failed") from exc
        try:
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported media type")
            if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
                raise KnowledgeFSProductRemoteError(f"KnowledgeFS returned HTTP {response.status_code}")
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned invalid JSON") from exc
        finally:
            response.close()


def _matches_path(template: str, path: str) -> bool:
    template_segments = template.strip("/").split("/")
    path_segments = path.strip("/").split("/")
    if len(template_segments) != len(path_segments):
        return False
    for expected, actual in zip(template_segments, path_segments, strict=True):
        if expected.startswith("{") and expected.endswith("}"):
            if not actual or actual in {".", ".."} or any(character in actual for character in ("%", "?", "#", "\\")):
                return False
        elif expected != actual:
            return False
    return True


__all__ = ["HTTPKnowledgeFSProductRemoteClient"]
