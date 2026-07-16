"""Transport-only forwarding for the allowlisted KnowledgeFS Console routes.

KnowledgeFS owns the request and response contract. This module only binds a
short-lived workspace identity and normalizes transport failures. The dedicated
request path uses Dify's shared SSRF policy, accepts only exact contract
operations, never follows redirects, bounds buffered identity responses, and
rejects compressed responses.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Literal, NamedTuple, cast

import httpx
import jwt

from configs import dify_config
from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.knowledge_fs_contract_routes import KNOWLEDGE_FS_CONTRACT_OPERATIONS

type KnowledgeFSMethod = Literal["DELETE", "GET", "PATCH", "POST", "PUT"]
type KnowledgeFSResponseKind = Literal["binary", "buffered", "stream"]
type KnowledgeFSAccess = Literal["read", "write"]
type KnowledgeFSRBACPermission = Literal[
    "dataset_access_config",
    "dataset_api_key_manage",
    "dataset_create_and_management",
    "dataset_document_download",
    "dataset_edit",
    "dataset_external_connect",
    "dataset_readonly",
]

_JWT_AUDIENCE = "knowledge-fs"
_JWT_ISSUER = "dify"
_JWT_TTL_SECONDS = 60
_MAX_BUFFERED_RESPONSE_BYTES = 1024 * 1024


class KnowledgeFSOperation(NamedTuple):
    method: KnowledgeFSMethod
    path: str
    response_kind: KnowledgeFSResponseKind
    access: KnowledgeFSAccess
    rbac_permission: KnowledgeFSRBACPermission
    max_response_bytes: int
    request_headers: tuple[str, ...]
    response_headers: tuple[str, ...]


class KnowledgeFSUpstreamResponse(NamedTuple):
    response: httpx.Response
    response_kind: KnowledgeFSResponseKind


class KnowledgeFSConfigurationError(RuntimeError):
    """KnowledgeFS is incompletely configured or blocked by outbound policy."""


class KnowledgeFSTimeoutError(RuntimeError):
    """KnowledgeFS exceeded the configured request timeout."""


class KnowledgeFSTransportError(RuntimeError):
    """KnowledgeFS could not be reached or returned a response outside safety bounds."""


class KnowledgeFSRouteNotAllowedError(RuntimeError):
    """The requested path is outside the Console-visible KnowledgeFS surface."""


def forward_knowledge_fs_request(
    *,
    method: KnowledgeFSMethod,
    path: str,
    tenant_id: str,
    accept: str | None = None,
    content_type: str | None = None,
    query: bytes | None = None,
    body: bytes | None = None,
    request_headers: Mapping[str, str] | None = None,
) -> KnowledgeFSUpstreamResponse:
    """Forward one fixed-route request without parsing its KnowledgeFS payload.

    Args:
        method: Allowlisted upstream HTTP method.
        path: Relative KnowledgeFS path under an allowlisted product surface.
        tenant_id: Current Dify workspace used as the KFS tenant identity.
        accept: Original Accept header, when present.
        content_type: Original request Content-Type header, when present.
        query: Original encoded query string from the Console request.
        body: Original request body, when present.
        request_headers: Contract-declared request headers forwarded by the Console adapter.

    Returns:
        The KnowledgeFS response and its actual transport kind. Non-success responses are buffered.

    Raises:
        KnowledgeFSConfigurationError: The connection is incomplete or blocked by outbound policy.
        KnowledgeFSRouteNotAllowedError: The path is outside the allowlisted product surface.
        KnowledgeFSTimeoutError: KnowledgeFS exceeds the configured timeout.
        KnowledgeFSTransportError: The request fails or its response cannot be safely bounded.

    Each request is bound to a stable Dify workspace principal with a short expiration.
    """
    operation = get_knowledge_fs_operation(method, path)
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    jwt_secret = dify_config.KNOWLEDGE_FS_JWT_SECRET
    if base_url is None or jwt_secret is None:
        raise KnowledgeFSConfigurationError("KnowledgeFS connection configuration is incomplete")
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "aud": _JWT_AUDIENCE,
            "caller_kind": "interactive",
            "exp": now + timedelta(seconds=_JWT_TTL_SECONDS),
            "iat": now,
            "iss": _JWT_ISSUER,
            "scopes": [f"knowledge-spaces:{operation.access}"],
            "sub": f"dify-workspace:{tenant_id}",
            "tenant_id": tenant_id,
        },
        jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    headers = {
        "Accept": accept or "application/json",
        "Accept-Encoding": "identity",
        "Authorization": f"Bearer {token}",
    }
    if body is not None:
        headers["Content-Type"] = content_type or "application/json"
    allowed_request_headers = set(operation.request_headers)
    for name, value in (request_headers or {}).items():
        normalized_name = name.lower()
        if normalized_name not in allowed_request_headers:
            raise KnowledgeFSRouteNotAllowedError("KnowledgeFS request header is not allowed")
        headers[normalized_name] = value

    try:
        upstream_url = httpx.URL(f"{base_url}/").join(operation.path)
        response = ssrf_proxy.make_request(
            method=operation.method,
            url=str(upstream_url),
            params=query,
            content=body,
            headers=headers,
            timeout=dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS,
            follow_redirects=False,
            max_retries=0,
            stream_response=True,
        )
        response_kind = _classify_response(operation, response)
        if response_kind == "stream":
            content_encoding = response.headers.get("content-encoding", "identity").strip().lower()
            if content_encoding not in {"", "identity"}:
                response.close()
                raise KnowledgeFSTransportError("KnowledgeFS streaming response used an unsupported encoding")
            _set_response_read_timeout(response, None)
            return KnowledgeFSUpstreamResponse(response, response_kind)

        max_response_bytes = (
            operation.max_response_bytes
            if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES
            else _MAX_BUFFERED_RESPONSE_BYTES
        )
        buffered_response = ssrf_proxy.buffer_response(response, max_response_bytes=max_response_bytes)
        return KnowledgeFSUpstreamResponse(buffered_response, response_kind)
    except ssrf_proxy.ResponseLimitError as exc:
        raise KnowledgeFSTransportError("KnowledgeFS response violated the proxy limit") from exc
    except ToolSSRFError as exc:
        raise KnowledgeFSConfigurationError("KnowledgeFS origin was blocked by outbound policy") from exc
    except httpx.TimeoutException as exc:
        raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
    except httpx.RequestError as exc:
        raise KnowledgeFSTransportError("KnowledgeFS transport request failed") from exc


def get_knowledge_fs_operation(method: KnowledgeFSMethod, path: str) -> KnowledgeFSOperation:
    """Resolve an exact operation and its transport/access contract metadata."""
    for (
        allowed_method,
        template,
        response_kind,
        access,
        rbac_permission,
        max_response_bytes,
        request_headers,
        response_headers,
    ) in KNOWLEDGE_FS_CONTRACT_OPERATIONS:
        if method == allowed_method and _matches_route_template(template, path):
            return KnowledgeFSOperation(
                method,
                path,
                response_kind=cast(KnowledgeFSResponseKind, response_kind),
                access=cast(KnowledgeFSAccess, access),
                rbac_permission=cast(KnowledgeFSRBACPermission, rbac_permission),
                max_response_bytes=max_response_bytes,
                request_headers=request_headers,
                response_headers=response_headers,
            )
    raise KnowledgeFSRouteNotAllowedError("KnowledgeFS route is not allowed")


def _classify_response(operation: KnowledgeFSOperation, response: httpx.Response) -> KnowledgeFSResponseKind:
    """Resolve the actual response kind from status and Content-Type before reading its body."""
    content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
    is_success = HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES
    if not is_success:
        if content_type and not _is_json_content_type(content_type):
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS error response used an unsupported media type")
        return "buffered"

    if operation.response_kind == "stream":
        if content_type != "text/event-stream":
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS stream response used an unsupported media type")
        return "stream"
    if operation.response_kind == "binary":
        if not content_type or _is_json_content_type(content_type):
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS binary response used an unsupported media type")
        return "binary"
    if content_type and not _is_json_content_type(content_type):
        response.close()
        raise KnowledgeFSTransportError("KnowledgeFS buffered response used an unsupported media type")
    return "buffered"


def _is_json_content_type(content_type: str) -> bool:
    return content_type == "application/json" or content_type.endswith("+json")


def _set_response_read_timeout(response: httpx.Response, timeout_seconds: float | None) -> None:
    """Set the body-read timeout after headers identify a valid SSE response."""
    try:
        request = response.request
    except RuntimeError:
        return
    timeout = request.extensions.get("timeout")
    if isinstance(timeout, dict):
        timeout["read"] = timeout_seconds


def _matches_route_template(template: str, path: str) -> bool:
    """Match path parameters without permitting encoded or traversal-like segments."""
    template_segments = template.split("/")
    path_segments = path.split("/")
    if len(template_segments) != len(path_segments):
        return False

    for template_segment, path_segment in zip(template_segments, path_segments, strict=True):
        if template_segment.startswith("{") and template_segment.endswith("}"):
            if (
                not path_segment
                or path_segment in {".", ".."}
                or "\\" in path_segment
                or "%" in path_segment
                or "?" in path_segment
                or "#" in path_segment
            ):
                return False
            continue
        if template_segment != path_segment:
            return False
    return True
