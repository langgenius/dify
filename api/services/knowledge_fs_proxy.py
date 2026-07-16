"""Transport-only forwarding for the allowlisted KnowledgeFS Console routes.

KnowledgeFS owns the request and response contract. This module only binds a
short-lived workspace identity and normalizes transport failures. The dedicated
request path uses Dify's shared SSRF policy, accepts only exact contract
operations, never follows redirects, bounds buffered identity responses, and
rejects compressed responses.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
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

_JWT_AUDIENCE = "knowledge-fs"
_JWT_ISSUER = "dify"
_JWT_TTL_SECONDS = 60
_MAX_BUFFERED_RESPONSE_BYTES = 1024 * 1024
_MAX_BINARY_RESPONSE_BYTES = 25 * 1024 * 1024


class KnowledgeFSOperation(NamedTuple):
    method: KnowledgeFSMethod
    path: str
    response_kind: KnowledgeFSResponseKind
    access: KnowledgeFSAccess


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

    Returns:
        The KnowledgeFS response and its generated contract response kind.

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

    try:
        upstream_url = httpx.URL(f"{base_url}/").join(operation.path)
        timeout: float | httpx.Timeout = dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS
        max_response_bytes: int | None
        if operation.response_kind == "stream":
            timeout = httpx.Timeout(dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS, read=None)
            max_response_bytes = None
        elif operation.response_kind == "binary":
            max_response_bytes = _MAX_BINARY_RESPONSE_BYTES
        else:
            max_response_bytes = _MAX_BUFFERED_RESPONSE_BYTES
        response = ssrf_proxy.make_request(
            method=operation.method,
            url=str(upstream_url),
            params=query,
            content=body,
            headers=headers,
            timeout=timeout,
            follow_redirects=False,
            max_retries=0,
            max_response_bytes=max_response_bytes,
            stream_response=operation.response_kind == "stream",
        )
        if operation.response_kind == "stream":
            content_encoding = response.headers.get("content-encoding", "identity").strip().lower()
            if content_encoding not in {"", "identity"}:
                response.close()
                raise KnowledgeFSTransportError("KnowledgeFS streaming response used an unsupported encoding")
        return KnowledgeFSUpstreamResponse(response, operation.response_kind)
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
    for allowed_method, template, response_kind, access in KNOWLEDGE_FS_CONTRACT_OPERATIONS:
        if method == allowed_method and _matches_route_template(template, path):
            return KnowledgeFSOperation(
                method,
                path,
                response_kind=cast(KnowledgeFSResponseKind, response_kind),
                access=cast(KnowledgeFSAccess, access),
            )
    raise KnowledgeFSRouteNotAllowedError("KnowledgeFS route is not allowed")


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
