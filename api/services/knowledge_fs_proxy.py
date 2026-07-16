"""Transport-only forwarding for the allowlisted KnowledgeFS Console routes.

KnowledgeFS owns the request and response contract. This module only binds a
short-lived workspace identity and normalizes transport failures. The dedicated
client may contact a private service because the origin is startup configuration,
paths are exact allowlisted operations, environment proxies are disabled, and
redirects are never followed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal, NamedTuple

import httpx
import jwt

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client

type KnowledgeFSMethod = Literal["GET", "POST"]

_JWT_AUDIENCE = "knowledge-fs"
_JWT_ISSUER = "dify"
_JWT_TTL_SECONDS = 60


class _KnowledgeFSUpstreamOperation(NamedTuple):
    method: KnowledgeFSMethod
    path: str


_ALLOWED_OPERATIONS: dict[tuple[KnowledgeFSMethod, str], _KnowledgeFSUpstreamOperation] = {
    ("GET", "knowledge-spaces"): _KnowledgeFSUpstreamOperation("GET", "knowledge-spaces"),
    ("POST", "knowledge-spaces"): _KnowledgeFSUpstreamOperation("POST", "knowledge-spaces"),
}

_HTTP_CLIENT = get_pooled_http_client(
    "knowledge-fs",
    lambda: httpx.Client(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        trust_env=False,
    ),
)


class KnowledgeFSConfigurationError(RuntimeError):
    """KnowledgeFS is not completely configured."""


class KnowledgeFSTimeoutError(RuntimeError):
    """KnowledgeFS exceeded the configured request timeout."""


class KnowledgeFSTransportError(RuntimeError):
    """KnowledgeFS could not be reached."""


class KnowledgeFSRouteNotAllowedError(RuntimeError):
    """The requested path is outside the Console-visible KnowledgeFS surface."""


def forward_knowledge_fs_request(
    *,
    method: KnowledgeFSMethod,
    path: str,
    tenant_id: str,
    query: bytes | None = None,
    body: bytes | None = None,
) -> httpx.Response:
    """Forward one fixed-route request without parsing its KnowledgeFS payload.

    Args:
        method: Allowlisted upstream HTTP method.
        path: Relative KnowledgeFS path under an allowlisted product surface.
        tenant_id: Current Dify workspace used as the KFS tenant identity.
        query: Original encoded query string from the Console request.
        body: Original JSON request body, when present.

    Returns:
        The raw KnowledgeFS response after one fixed-origin outbound request.

    Raises:
        KnowledgeFSConfigurationError: The connection is incomplete.
        KnowledgeFSRouteNotAllowedError: The path is outside the allowlisted product surface.
        KnowledgeFSTimeoutError: KnowledgeFS exceeds the configured timeout.
        KnowledgeFSTransportError: The request fails.

    Each request is bound to a stable Dify workspace principal with a short expiration.
    """
    operation = _ALLOWED_OPERATIONS.get((method, path))
    if operation is None:
        raise KnowledgeFSRouteNotAllowedError("KnowledgeFS route is not allowed")
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
            "scopes": ["knowledge-spaces:read" if method == "GET" else "knowledge-spaces:write"],
            "sub": f"dify-workspace:{tenant_id}",
            "tenant_id": tenant_id,
        },
        jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"

    try:
        upstream_url = httpx.URL(f"{base_url}/").join(operation.path)
        return _HTTP_CLIENT.request(
            operation.method,
            upstream_url,
            params=query,
            content=body,
            headers=headers,
            timeout=dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS,
            follow_redirects=False,
        )
    except httpx.TimeoutException as exc:
        raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
    except httpx.RequestError as exc:
        raise KnowledgeFSTransportError("KnowledgeFS transport request failed") from exc
