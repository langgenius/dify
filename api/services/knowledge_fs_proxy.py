"""Transport-only forwarding for the allowlisted KnowledgeFS Console routes.

KnowledgeFS owns the request and response contract. This module only binds a
server credential, enforces the local single-workspace tenant invariant, and
normalizes transport failures.
"""

from __future__ import annotations

from typing import Literal

import httpx

from configs import dify_config
from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError

type KnowledgeFSMethod = Literal["GET", "POST"]


class KnowledgeFSConfigurationError(RuntimeError):
    """KnowledgeFS is partially configured or bound to another workspace."""


class KnowledgeFSTimeoutError(RuntimeError):
    """KnowledgeFS exceeded the configured request timeout."""


class KnowledgeFSTransportError(RuntimeError):
    """KnowledgeFS could not be reached."""


def forward_knowledge_fs_request(
    *,
    method: KnowledgeFSMethod,
    tenant_id: str,
    query: bytes | None = None,
    body: bytes | None = None,
) -> httpx.Response:
    """Forward one fixed-route request without parsing its KnowledgeFS payload.

    Args:
        method: Allowlisted upstream HTTP method.
        tenant_id: Current Dify workspace, which must match the static KFS binding.
        query: Original encoded query string from the Console request.
        body: Original JSON request body, when present.

    Returns:
        The raw KnowledgeFS response after one SSRF-protected outbound request.

    Raises:
        KnowledgeFSConfigurationError: The connection is incomplete or the workspace does not match.
        KnowledgeFSTimeoutError: KnowledgeFS exceeds the configured timeout.
        KnowledgeFSTransportError: The request fails or SSRF protection blocks it.

    The configured bearer token is trusted to belong to the configured static tenant.
    """
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    api_token = dify_config.KNOWLEDGE_FS_API_TOKEN
    expected_tenant_id = dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID
    if base_url is None or api_token is None or expected_tenant_id is None:
        raise KnowledgeFSConfigurationError("KnowledgeFS connection configuration is incomplete")
    if tenant_id != expected_tenant_id:
        raise KnowledgeFSConfigurationError("KNOWLEDGE_FS_STATIC_TENANT_ID does not match the current Dify workspace")

    token = api_token.get_secret_value()
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"

    try:
        return ssrf_proxy.make_request(
            method,
            f"{base_url}/knowledge-spaces",
            max_retries=0,
            params=query,
            content=body,
            headers=headers,
            timeout=float(dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS),
            follow_redirects=False,
            ssl_verify=True,
        )
    except httpx.TimeoutException as exc:
        raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
    except (httpx.RequestError, ToolSSRFError) as exc:
        raise KnowledgeFSTransportError("KnowledgeFS transport request failed") from exc
