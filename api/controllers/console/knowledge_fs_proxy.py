"""Authenticated transport adapter for the Console-to-KnowledgeFS proxy.

These raw Blueprint routes deliberately stay outside Dify's OpenAPI surface:
KnowledgeFS owns the wire contract consumed by the frontend. The catch-all path
avoids resource-specific Dify controllers, while the forwarding module consumes
the exact operation templates generated from the pinned KnowledgeFS contract.
Console auth and contract-specific dataset RBAC run before forwarding. Request
bodies are capped at 64 MiB, JSON and binary responses have separate bounds,
SSE responses remain streaming, only safe response headers are exposed, and
upstream 401/403 responses become 502 so they cannot trigger Dify browser-session
recovery.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from functools import wraps
from http import HTTPStatus
from typing import NoReturn, cast

import httpx
from flask import Response, request, stream_with_context
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
    KnowledgeFSUpstreamResponse,
    forward_knowledge_fs_request,
    get_knowledge_fs_operation,
)

logger = logging.getLogger(__name__)

_MAX_PROXY_BODY_BYTES = 64 * 1024 * 1024
_MAX_STREAM_RESPONSE_BYTES = 64 * 1024 * 1024
_RESPONSE_HEADER_ALLOWLIST = (
    "Cache-Control",
    "Content-Disposition",
    "Content-Type",
    "Retry-After",
    "X-Trace-Id",
)


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


def _stream_response_body(upstream: httpx.Response, *, tenant_id: str) -> Iterator[bytes]:
    """Yield one bounded SSE response and always release its pooled connection."""
    total_bytes = 0
    try:
        for chunk in upstream.iter_bytes():
            total_bytes += len(chunk)
            if total_bytes > _MAX_STREAM_RESPONSE_BYTES:
                logger.warning("KnowledgeFS stream exceeded the proxy limit for tenant_id=%s", tenant_id)
                return
            yield chunk
    except httpx.RequestError:
        logger.warning("KnowledgeFS stream disconnected for tenant_id=%s", tenant_id)
    finally:
        upstream.close()


def _proxy_response(upstream_result: KnowledgeFSUpstreamResponse, *, tenant_id: str) -> Response:
    """Expose raw content, status, and allowlisted headers from KnowledgeFS.

    Raises:
        BadGateway: KnowledgeFS rejects the configured server credential.
    """
    upstream = upstream_result.response
    if upstream.status_code in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
        upstream.close()
        logger.error(
            "KnowledgeFS rejected the Dify server credential with HTTP %s for tenant_id=%s",
            upstream.status_code,
            tenant_id,
        )
        raise BadGateway("KnowledgeFS authentication failed")

    headers = {name: value for name in _RESPONSE_HEADER_ALLOWLIST if (value := upstream.headers.get(name)) is not None}
    if upstream_result.response_kind == "stream":
        response = Response(
            stream_with_context(_stream_response_body(upstream, tenant_id=tenant_id)),
            status=upstream.status_code,
            headers=headers,
        )
        response.call_on_close(upstream.close)
        return response

    try:
        content = upstream.content
    finally:
        upstream.close()
    return Response(content, status=upstream.status_code, headers=headers)


def _proxy_request(method: KnowledgeFSMethod, upstream_path: str) -> Response:
    """Forward the current raw request and return its filtered upstream response.

    The call performs one outbound KnowledgeFS request. Integration failures are
    converted to Console HTTP exceptions for the outer JSON error adapter.
    """
    current_user, tenant_id = current_account_with_tenant()
    try:
        operation = get_knowledge_fs_operation(method, upstream_path)
        if operation.access == "write" and not current_user.is_dataset_editor:
            raise Forbidden()
        upstream = forward_knowledge_fs_request(
            method=method,
            path=upstream_path,
            tenant_id=tenant_id,
            accept=request.headers.get("Accept"),
            content_type=request.content_type,
            query=request.query_string or None,
            body=_request_body() if method != "GET" else None,
        )
    except (
        KnowledgeFSConfigurationError,
        KnowledgeFSRouteNotAllowedError,
        KnowledgeFSTimeoutError,
        KnowledgeFSTransportError,
    ) as exc:
        _translate_proxy_error(exc, tenant_id=tenant_id)
    return _proxy_response(upstream, tenant_id=tenant_id)


@rbac_permission_required(
    RBACResourceScope.DATASET,
    RBACPermission.DATASET_READONLY,
    resource_required=False,
)
@cloud_edition_billing_rate_limit_check("knowledge")
def _proxy_knowledge_fs_read_operation(
    method: KnowledgeFSMethod,
    upstream_path: str,
) -> ResponseReturnValue:
    """Apply read RBAC and billing checks to contract-declared read-only non-GET operations."""
    return _proxy_request(method, upstream_path)


@rbac_permission_required(
    RBACResourceScope.DATASET,
    RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
    resource_required=False,
)
@cloud_edition_billing_rate_limit_check("knowledge")
def _proxy_knowledge_fs_mutation(upstream_path: str) -> ResponseReturnValue:
    """Apply mutation RBAC and billing checks to contract-declared writes."""
    return _proxy_request(cast(KnowledgeFSMethod, request.method), upstream_path)


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


@bp.route("/knowledge-fs/<path:upstream_path>", methods=["DELETE", "PATCH", "POST", "PUT"])
@_console_api_errors
@setup_required
@login_required
@account_initialization_required
def proxy_knowledge_fs_write(upstream_path: str) -> ResponseReturnValue:
    """Forward one authenticated non-GET request under its contract access policy.

    Args:
        upstream_path: Relative KFS path captured after the Console proxy prefix.

    Returns:
        The filtered raw KnowledgeFS response or a Console JSON error response.
    """
    method = cast(KnowledgeFSMethod, request.method)
    try:
        operation = get_knowledge_fs_operation(method, upstream_path)
    except KnowledgeFSRouteNotAllowedError as exc:
        raise NotFound() from exc
    if operation.access == "read":
        return _proxy_knowledge_fs_read_operation(method, upstream_path)
    return _proxy_knowledge_fs_mutation(upstream_path)
