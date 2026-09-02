"""Capability-only HTTP transport for manifest-approved buffered and SSE calls."""

from __future__ import annotations

import json
import logging
import re
from http import HTTPStatus
from typing import Literal, cast
from urllib.parse import urlencode

import httpx
from pydantic import JsonValue, TypeAdapter, ValidationError

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.knowledge_fs.product_dto import (
    KnowledgeFSBatchTechnicalSummaryResponse,
    KnowledgeFSPublicFailureResponse,
    KnowledgeFSTechnicalSummary,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER,
    KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES,
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
    KnowledgeFSRemoteMultipartRequest,
    KnowledgeFSRemoteSSERequest,
    KnowledgeFSRemoteSSEResponse,
)

_JSON_ADAPTER: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
logger = logging.getLogger(__name__)

_ERROR_CONTRACT_HEADER = "X-KnowledgeFS-Error-Contract"
_ERROR_CONTRACT_VERSION = "2"
_REJECTED_STATUS_CODES = frozenset({400, 403, 409, 413, 422, 429})
_MAX_BATCH_SUMMARIES = 100
_SSE_RESPONSE_HEADERS = (
    "cache-control",
    "content-type",
    "retry-after",
    "x-accel-buffering",
    "x-query-run-id",
    "x-session-id",
    "x-trace-id",
)
_BASE64URL_HEADER_VALUE = re.compile(r"^[A-Za-z0-9_-]+$")


class HTTPKnowledgeFSProductRemoteClient:
    """Build outbound headers from trusted capability input; browser headers never enter this class."""

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float,
        retrieval_test_timeout_seconds: float | None = None,
        max_response_bytes: int = 4 * 1024 * 1024,
    ) -> None:
        self._base_url = base_url
        self._timeout_seconds = timeout_seconds
        self._retrieval_test_timeout_seconds = (
            timeout_seconds if retrieval_test_timeout_seconds is None else retrieval_test_timeout_seconds
        )
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
            operation_id="batchSpaceSummaries",
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
            operation_id=request.operation_id,
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
            _ERROR_CONTRACT_HEADER: _ERROR_CONTRACT_VERSION,
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
            if response.status_code in _REJECTED_STATUS_CODES:
                raise _request_rejected(response)
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported media type")
            if response.status_code == HTTPStatus.NOT_FOUND:
                raise KnowledgeFSProductResourceNotFoundError(
                    "KnowledgeFS resource was not found",
                    failure=_public_failure_from_response(response),
                )
            if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
                raise KnowledgeFSProductRemoteError(
                    f"KnowledgeFS returned HTTP {response.status_code}",
                    failure=_public_failure_from_response(response),
                )
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned invalid JSON") from exc
        finally:
            response.close()

    def execute_multipart(self, request: KnowledgeFSRemoteMultipartRequest) -> JsonValue:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(request.operation_id)
        if (
            operation is None
            or operation.transport != "multipart"
            or not is_product_operation_ready(request.operation_id)
        ):
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {request.operation_id}")
        if (
            request.method != operation.method
            or operation.kfs_path is None
            or not _matches_path(operation.kfs_path, request.path)
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS request does not match its operation manifest")
        file = request.file
        if (
            not request.namespace_id
            or not request.knowledge_space_id
            or not request.capability_token
            or not request.trace_id
            or request.query
        ):
            raise KnowledgeFSProductRemoteError("KnowledgeFS multipart request binding is incomplete")
        if (
            not file.filename.strip()
            or len(file.filename) > 255
            or any(character in file.filename for character in ("\0", "\r", "\n"))
            or not file.content_type.strip()
            or len(file.content_type) > 255
            or any(character in file.content_type for character in ("\0", "\r", "\n"))
            or not isinstance(file.body, bytes)
            or not file.body
        ):
            raise KnowledgeFSProductRequestRejectedError(status_code=422)
        if len(file.body) > operation.max_request_bytes:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)
        response_limit = min(self._max_response_bytes, operation.max_response_bytes)
        if response_limit <= 0:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS operation response limit is unavailable")
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {request.capability_token}",
            "X-Trace-Id": request.trace_id,
            _ERROR_CONTRACT_HEADER: _ERROR_CONTRACT_VERSION,
        }
        try:
            upstream_url = httpx.URL(f"{self._base_url.rstrip('/')}/").join(request.path.lstrip("/"))
            response = ssrf_proxy.make_request(
                method=request.method,
                url=str(upstream_url),
                headers=headers,
                files={"file": (file.filename, file.body, file.content_type)},
                timeout=self._timeout_seconds,
                follow_redirects=False,
                max_retries=0,
                stream_response=True,
            )
            response = ssrf_proxy.buffer_response(response, max_response_bytes=response_limit)
        except (ssrf_proxy.ResponseLimitError, httpx.RequestError, ToolSSRFError) as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request failed") from exc
        try:
            if response.status_code in _REJECTED_STATUS_CODES:
                _log_upstream_rejection(
                    operation_id=request.operation_id,
                    trace_id=request.trace_id,
                    response=response,
                )
            if response.status_code in _REJECTED_STATUS_CODES:
                raise _request_rejected(response)
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported media type")
            if response.status_code == HTTPStatus.NOT_FOUND:
                raise KnowledgeFSProductResourceNotFoundError(
                    "KnowledgeFS resource was not found",
                    failure=_public_failure_from_response(response),
                )
            if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
                raise KnowledgeFSProductRemoteError(
                    f"KnowledgeFS returned HTTP {response.status_code}",
                    failure=_public_failure_from_response(response),
                )
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned invalid JSON") from exc
        finally:
            response.close()

    def execute_sse(self, request: KnowledgeFSRemoteSSERequest) -> KnowledgeFSRemoteSSEResponse:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(request.operation_id)
        if operation is None or operation.transport != "sse" or not is_product_operation_ready(request.operation_id):
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {request.operation_id}")
        if (
            request.method != operation.method
            or operation.kfs_path is None
            or not _matches_path(operation.kfs_path, request.path)
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS request does not match its operation manifest")
        if not request.capability_token or not request.trace_id:
            raise KnowledgeFSProductRemoteError("KnowledgeFS SSE request binding is incomplete")
        try:
            encoded_payload = (
                None
                if request.payload is None
                else json.dumps(
                    request.payload,
                    ensure_ascii=False,
                    allow_nan=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            )
        except (TypeError, ValueError) as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request payload is invalid") from exc
        request_size = len(urlencode(request.query).encode("utf-8"))
        if encoded_payload is not None:
            request_size += len(encoded_payload)
        if request_size > operation.max_request_bytes:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)
        headers = {
            "Accept": "text/event-stream",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {request.capability_token}",
            "X-Trace-Id": request.trace_id,
            _ERROR_CONTRACT_HEADER: _ERROR_CONTRACT_VERSION,
        }
        request_kwargs: dict[str, object] = {
            "headers": headers,
            "params": request.query,
            "timeout": httpx.Timeout(
                connect=self._timeout_seconds,
                read=None,
                write=self._timeout_seconds,
                pool=self._timeout_seconds,
            ),
            "follow_redirects": False,
        }
        if encoded_payload is not None:
            headers["Content-Type"] = "application/json"
            request_kwargs["content"] = encoded_payload
        try:
            upstream_url = httpx.URL(f"{self._base_url.rstrip('/')}/").join(request.path.lstrip("/"))
            response = ssrf_proxy.make_request(
                method=request.method,
                url=str(upstream_url),
                max_retries=0,
                stream_response=True,
                **request_kwargs,
            )
        except (httpx.RequestError, ToolSSRFError) as exc:
            raise KnowledgeFSProductRemoteError("KnowledgeFS SSE request failed") from exc
        content_encoding = response.headers.get("content-encoding", "identity").strip().lower()
        if content_encoding not in {"", "identity"}:
            response.close()
            raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported SSE encoding")
        content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
        if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
            if content_type != "text/event-stream":
                response.close()
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported SSE media type")
        elif content_type != "application/json" and not content_type.endswith("+json"):
            response.close()
            raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported error media type")
        response_headers = tuple(
            (name, value) for name in _SSE_RESPONSE_HEADERS if (value := response.headers.get(name)) is not None
        )
        return KnowledgeFSRemoteSSEResponse(
            status_code=response.status_code,
            headers=response_headers,
            chunks=response.iter_bytes(),
            close=response.close,
        )

    def _request_json(
        self,
        *,
        operation_id: str,
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
        response_limit = min(self._max_response_bytes, max_response_bytes)
        if response_limit <= 0:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS operation response limit is unavailable")
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {capability_token}",
            "X-Trace-Id": trace_id,
            _ERROR_CONTRACT_HEADER: _ERROR_CONTRACT_VERSION,
        }
        seen_extra_headers: set[str] = set()
        for name, value in extra_headers:
            if not isinstance(name, str) or not isinstance(value, str):
                raise KnowledgeFSProductRemoteError("KnowledgeFS request header binding is invalid")
            normalized_name = name.strip().lower()
            normalized_value = value.strip()
            if normalized_name in seen_extra_headers:
                raise KnowledgeFSProductRemoteError("KnowledgeFS request header binding is invalid")
            seen_extra_headers.add(normalized_name)
            if (
                normalized_name == "idempotency-key"
                and normalized_value == value
                and "\r" not in value
                and "\n" not in value
                and 8 <= len(normalized_value) <= 255
            ):
                headers["Idempotency-Key"] = normalized_value
            elif (
                normalized_name == KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER.lower()
                and operation_id == "retrieveEvidence"
                and normalized_value == value
                and len(normalized_value.encode("ascii", errors="ignore"))
                <= KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES
                and _BASE64URL_HEADER_VALUE.fullmatch(normalized_value)
            ):
                headers[KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER] = normalized_value
            else:
                raise KnowledgeFSProductRemoteError("KnowledgeFS request header binding is invalid")
            request_size += len(name.encode("utf-8")) + len(value.encode("utf-8")) + 4
        if request_size > max_request_bytes:
            raise KnowledgeFSProductRemoteError("KnowledgeFS request exceeds its operation byte limit")
        request_kwargs: dict[str, object] = {
            "headers": headers,
            "params": query,
            "timeout": (
                self._retrieval_test_timeout_seconds if operation_id == "retrieveEvidence" else self._timeout_seconds
            ),
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
            if response.status_code in _REJECTED_STATUS_CODES:
                _log_upstream_rejection(
                    operation_id=operation_id,
                    trace_id=trace_id,
                    response=response,
                )
            if response.status_code in _REJECTED_STATUS_CODES:
                raise _request_rejected(response)
            if response.status_code == HTTPStatus.NO_CONTENT:
                return None
            content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned an unsupported media type")
            if response.status_code == HTTPStatus.NOT_FOUND:
                raise KnowledgeFSProductResourceNotFoundError(
                    "KnowledgeFS resource was not found",
                    failure=_public_failure_from_response(response),
                )
            if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
                raise KnowledgeFSProductRemoteError(
                    f"KnowledgeFS returned HTTP {response.status_code}",
                    failure=_public_failure_from_response(response),
                )
            try:
                return _JSON_ADAPTER.validate_python(response.json())
            except (ValueError, ValidationError) as exc:
                raise KnowledgeFSProductRemoteError("KnowledgeFS returned invalid JSON") from exc
        finally:
            response.close()


def _request_rejected(response: httpx.Response) -> KnowledgeFSProductRequestRejectedError:
    status_code = cast(Literal[400, 403, 409, 413, 422, 429], response.status_code)
    return KnowledgeFSProductRequestRejectedError(
        status_code=status_code,
        failure=_public_failure_from_response(response),
    )


def _public_failure_from_response(response: httpx.Response) -> KnowledgeFSPublicFailureResponse | None:
    content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
    if content_type != "application/json" and not content_type.endswith("+json"):
        return None
    try:
        body = response.json()
        if not isinstance(body, dict):
            return None
        failure = body.get("failure")
        if not isinstance(failure, dict):
            return None
        return KnowledgeFSPublicFailureResponse.model_validate(failure)
    except (ValueError, ValidationError):
        return None


def _log_upstream_rejection(*, operation_id: str, trace_id: str, response: httpx.Response) -> None:
    """Log bounded, allowlisted failure metadata without exposing upstream diagnostic messages."""
    failure = _public_failure_from_response(response)
    logger.warning(
        "KnowledgeFS rejected JSON request: operation_id=%s trace_id=%s status_code=%s "
        "upstream_code=%s upstream_category=%s upstream_action=%s",
        operation_id,
        trace_id,
        response.status_code,
        failure.code if failure else "unavailable",
        failure.category if failure else "unavailable",
        failure.action if failure and failure.action else "unavailable",
    )


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
