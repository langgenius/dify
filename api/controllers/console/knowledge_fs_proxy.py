"""Authenticated transport adapter for the Console-to-KnowledgeFS proxy.

These raw Blueprint routes deliberately stay outside Dify's OpenAPI surface:
KnowledgeFS owns the wire contract consumed by the frontend. The catch-all path
avoids resource-specific Dify controllers, while the forwarding module retains
the explicit product-level operation allowlist. Console auth and method-specific
dataset RBAC run before forwarding. Bodies are capped at 64 KiB, only safe
response headers are exposed, and upstream 401/403 responses become 502 so they
cannot trigger Dify browser-session recovery.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import NoReturn

import httpx
from flask import Response, request
from flask.typing import ResponseReturnValue
from werkzeug.exceptions import (
    BadGateway,
    Forbidden,
    GatewayTimeout,
    NotFound,
    RequestEntityTooLarge,
    ServiceUnavailable,
)

from controllers.console import api, bp
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    rbac_permission_required,
    setup_required,
)
from libs.login import current_account_with_tenant, login_required
from services.knowledge_fs_proxy import (
    KnowledgeFSConfigurationError,
    KnowledgeFSMethod,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    forward_knowledge_fs_request,
)

logger = logging.getLogger(__name__)

_MAX_PROXY_BODY_BYTES = 64 * 1024
_RESPONSE_HEADER_ALLOWLIST = ("Cache-Control", "Content-Type", "Retry-After", "X-Trace-Id")


def _console_api_errors[**P](
    view: Callable[P, ResponseReturnValue],
) -> Callable[P, ResponseReturnValue]:
    """Route raw Blueprint exceptions through the Console API JSON handlers."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> ResponseReturnValue:
        try:
            return view(*args, **kwargs)
        except Exception as exc:
            return api.handle_error(exc)

    return decorated


def _translate_proxy_error(exc: Exception, *, tenant_id: str) -> NoReturn:
    """Map forwarding failures to the stable Console HTTP error surface."""
    if isinstance(exc, KnowledgeFSRouteNotAllowedError):
        raise NotFound() from exc
    if isinstance(exc, KnowledgeFSConfigurationError):
        logger.error("KnowledgeFS request was blocked by invalid configuration for tenant_id=%s", tenant_id)
        raise ServiceUnavailable("KnowledgeFS integration is misconfigured") from exc
    if isinstance(exc, KnowledgeFSTimeoutError):
        raise GatewayTimeout("KnowledgeFS request timed out") from exc
    if isinstance(exc, KnowledgeFSTransportError):
        logger.warning("KnowledgeFS transport request failed for tenant_id=%s", tenant_id)
        raise BadGateway("KnowledgeFS is unavailable") from exc
    raise exc


def _request_body() -> bytes:
    """Read the raw body up to the proxy limit or raise RequestEntityTooLarge."""
    body = request.stream.read(_MAX_PROXY_BODY_BYTES + 1)
    if len(body) > _MAX_PROXY_BODY_BYTES:
        raise RequestEntityTooLarge("KnowledgeFS proxy request body is too large")
    return body


def _proxy_response(upstream: httpx.Response, *, tenant_id: str) -> Response:
    """Expose raw content, status, and allowlisted headers from KnowledgeFS.

    Raises:
        BadGateway: KnowledgeFS rejects the configured server credential.
    """
    if upstream.status_code in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
        logger.error(
            "KnowledgeFS rejected the Dify server credential with HTTP %s for tenant_id=%s",
            upstream.status_code,
            tenant_id,
        )
        raise BadGateway("KnowledgeFS authentication failed")

    headers = {name: value for name in _RESPONSE_HEADER_ALLOWLIST if (value := upstream.headers.get(name)) is not None}
    return Response(upstream.content, status=upstream.status_code, headers=headers)


def _proxy_request(method: KnowledgeFSMethod, upstream_path: str) -> Response:
    """Forward the current raw request and return its filtered upstream response.

    The call performs one outbound KnowledgeFS request. Integration failures are
    converted to Console HTTP exceptions for the outer JSON error adapter.
    """
    current_user, tenant_id = current_account_with_tenant()
    if method == "POST" and not current_user.is_dataset_editor:
        raise Forbidden()

    try:
        upstream = forward_knowledge_fs_request(
            method=method,
            path=upstream_path,
            tenant_id=tenant_id,
            query=request.query_string or None,
            body=_request_body() if method == "POST" else None,
        )
    except (
        KnowledgeFSConfigurationError,
        KnowledgeFSRouteNotAllowedError,
        KnowledgeFSTimeoutError,
        KnowledgeFSTransportError,
    ) as exc:
        _translate_proxy_error(exc, tenant_id=tenant_id)
    return _proxy_response(upstream, tenant_id=tenant_id)


@bp.route("/knowledge-fs/<path:upstream_path>", methods=["GET"])
@_console_api_errors
@setup_required
@login_required
@account_initialization_required
@rbac_permission_required(
    RBACResourceScope.DATASET,
    RBACPermission.DATASET_READONLY,
    resource_required=False,
)
def proxy_knowledge_fs_get(upstream_path: str) -> ResponseReturnValue:
    """Forward one authenticated, dataset-readable GET request.

    Args:
        upstream_path: Relative KFS path captured after the Console proxy prefix.

    Returns:
        The filtered raw KnowledgeFS response or a Console JSON error response.
    """
    return _proxy_request("GET", upstream_path)


@bp.route("/knowledge-fs/<path:upstream_path>", methods=["POST"])
@_console_api_errors
@setup_required
@login_required
@account_initialization_required
@rbac_permission_required(
    RBACResourceScope.DATASET,
    RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
    resource_required=False,
)
@cloud_edition_billing_rate_limit_check("knowledge")
def proxy_knowledge_fs_post(upstream_path: str) -> ResponseReturnValue:
    """Forward one authenticated, dataset-manageable POST request.

    Args:
        upstream_path: Relative KFS path captured after the Console proxy prefix.

    Returns:
        The filtered raw KnowledgeFS response or a Console JSON error response.
    """
    return _proxy_request("POST", upstream_path)
