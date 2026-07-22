"""Authenticated transport adapter for the Console-to-KnowledgeFS proxy.

These raw Blueprint routes deliberately stay outside Dify's OpenAPI surface:
KnowledgeFS owns the wire contract consumed by the frontend. The catch-all path
avoids resource-specific Dify controllers, while the forwarding module consumes
only the operations explicitly enabled by Dify's product registry. The registry
can be validated explicitly against the pinned KnowledgeFS contract during development.
Console auth and contract-specific dataset RBAC run before forwarding. Request
bodies are capped at 64 MiB, JSON and binary responses have separate bounds,
SSE responses remain streaming with a bounded idle read timeout, and only safe
response headers are exposed. Operation-specific upstream error mappings are
applied before Console JSON error handling; the default maps 401 to 502 so it
cannot trigger browser-session recovery and preserves resource-level 403.
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
    HTTPException,
    NotFound,
    RequestEntityTooLarge,
    ServiceUnavailable,
    default_exceptions,
)

from configs import dify_config
from controllers.console import api, bp
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)
from core.helper import ssrf_proxy
from libs.login import current_account_with_tenant, login_required
from services.knowledge_fs_operations import KnowledgeFSMethod
from services.knowledge_fs_proxy import (
    KnowledgeFSAccessDeniedError,
    KnowledgeFSAuthorization,
    KnowledgeFSConfigurationError,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    KnowledgeFSUpstreamResponse,
    authorize_knowledge_fs_request,
    get_knowledge_fs_operation,
    proxy_authorized_knowledge_fs_request,
    proxy_knowledge_fs_request,
)

logger = logging.getLogger(__name__)

type _KnowledgeFSRequestForwarder = Callable[
    [str | None, str | None, bytes | None, bytes | None],
    KnowledgeFSUpstreamResponse,
]

_MAX_PROXY_BODY_BYTES = 64 * 1024 * 1024
_RESPONSE_HEADER_ALLOWLIST = (
    "Cache-Control",
    "Content-Disposition",
    "Content-Type",
    "Retry-After",
    "X-Trace-Id",
)
_RESPONSE_HEADER_DENYLIST = frozenset(
    {
        "authorization",
        "connection",
        "cookie",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "set-cookie",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    }
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


def _knowledge_fs_enabled[**P](
    view: Callable[P, ResponseReturnValue],
) -> Callable[P, ResponseReturnValue]:
    """Hide the complete KnowledgeFS route surface while the bridge is disabled."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> ResponseReturnValue:
        if not dify_config.KNOWLEDGE_FS_ENABLED:
            raise NotFound()
        return view(*args, **kwargs)

    return decorated


def _translate_proxy_error(exc: Exception, *, tenant_id: str) -> NoReturn:
    """Map forwarding failures to the stable Console HTTP error surface."""
    if isinstance(exc, KnowledgeFSRouteNotAllowedError):
        raise NotFound() from exc
    if isinstance(exc, KnowledgeFSAccessDeniedError):
        raise Forbidden() from exc
    if isinstance(exc, KnowledgeFSConfigurationError):
        logger.error("KnowledgeFS request was blocked by invalid configuration for tenant_id=%s", tenant_id)
        raise ServiceUnavailable("KnowledgeFS integration is misconfigured") from exc
    if isinstance(exc, KnowledgeFSTimeoutError):
        raise GatewayTimeout("KnowledgeFS request timed out") from exc
    if isinstance(exc, KnowledgeFSTransportError):
        logger.warning("KnowledgeFS transport request failed for tenant_id=%s", tenant_id)
        raise BadGateway("KnowledgeFS is unavailable") from exc
    raise exc


def _knowledge_fs_operation_access_required(
    view: Callable[[KnowledgeFSAuthorization], ResponseReturnValue],
) -> Callable[[KnowledgeFSMethod, str], ResponseReturnValue]:
    """Authorize one declared operation before billing and request-body work."""

    @wraps(view)
    def decorated(method: KnowledgeFSMethod, upstream_path: str) -> ResponseReturnValue:
        try:
            operation = get_knowledge_fs_operation(method, upstream_path)
        except KnowledgeFSRouteNotAllowedError as exc:
            raise NotFound() from exc

        current_user, tenant_id = current_account_with_tenant()
        try:
            authorization = authorize_knowledge_fs_request(
                account=current_user,
                tenant_id=tenant_id,
                operation=operation,
            )
        except KnowledgeFSAccessDeniedError as exc:
            _translate_proxy_error(exc, tenant_id=tenant_id)
        return view(authorization)

    return decorated


def _request_body() -> bytes:
    """Read the raw body up to the proxy limit or raise RequestEntityTooLarge."""
    body = request.stream.read(_MAX_PROXY_BODY_BYTES + 1)
    if len(body) > _MAX_PROXY_BODY_BYTES:
        raise RequestEntityTooLarge("KnowledgeFS proxy request body is too large")
    return body


def _stream_response_body(
    upstream: httpx.Response,
    *,
    tenant_id: str,
    max_response_bytes: int,
) -> Iterator[bytes]:
    """Yield one bounded SSE response and always release its pooled connection."""
    total_bytes = 0
    try:
        for chunk in upstream.iter_bytes():
            total_bytes += len(chunk)
            if total_bytes > max_response_bytes:
                logger.warning("KnowledgeFS stream exceeded the proxy limit for tenant_id=%s", tenant_id)
                raise ssrf_proxy.ResponseTooLargeError(f"response exceeded {max_response_bytes} bytes")
            yield chunk
    finally:
        upstream.close()


def _proxy_response(
    upstream_result: KnowledgeFSUpstreamResponse,
    *,
    tenant_id: str,
    contract_response_headers: tuple[str, ...],
    max_response_bytes: int,
) -> Response:
    """Expose raw content, status, and allowlisted headers from KnowledgeFS.

    Raises:
        HTTPException: KnowledgeFS returns a status normalized by the operation contract.
    """
    upstream = upstream_result.response
    mapped_status = dict(upstream_result.operation.error_status_map).get(upstream.status_code)
    if mapped_status is not None:
        upstream.close()
        description = "KnowledgeFS upstream request failed"
        if upstream.status_code == HTTPStatus.UNAUTHORIZED:
            description = "KnowledgeFS authentication failed"
            logger.error(
                "KnowledgeFS rejected the Dify server credential with HTTP %s for tenant_id=%s",
                upstream.status_code,
                tenant_id,
            )
        exception_type = default_exceptions.get(mapped_status)
        if exception_type is None:
            exception = HTTPException(description)
            exception.code = mapped_status
            raise exception
        raise exception_type(description)

    allowed_header_names = dict.fromkeys(
        name.lower() for name in (*_RESPONSE_HEADER_ALLOWLIST, *contract_response_headers)
    )
    headers = {
        name: value
        for name in allowed_header_names
        if name not in _RESPONSE_HEADER_DENYLIST
        if (value := upstream.headers.get(name)) is not None
    }
    if upstream_result.response_kind == "stream":
        response = Response(
            stream_with_context(  # pyrefly: ignore[no-matching-overload]
                _stream_response_body(
                    upstream,
                    tenant_id=tenant_id,
                    max_response_bytes=max_response_bytes,
                )
            ),
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


def _proxy_current_request(
    *,
    method: KnowledgeFSMethod,
    tenant_id: str,
    forward: _KnowledgeFSRequestForwarder,
) -> Response:
    """Forward the current raw request through one preconfigured service entry."""
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    try:
        proxy_result = forward(
            request.headers.get("Accept"),
            request.content_type,
            request.query_string or None,
            _request_body() if method != "GET" else None,
        )
    except (
        KnowledgeFSConfigurationError,
        KnowledgeFSAccessDeniedError,
        KnowledgeFSRouteNotAllowedError,
        KnowledgeFSTimeoutError,
        KnowledgeFSTransportError,
    ) as exc:
        _translate_proxy_error(exc, tenant_id=tenant_id)
    return _proxy_response(
        proxy_result,
        tenant_id=tenant_id,
        contract_response_headers=proxy_result.operation.response_headers,
        max_response_bytes=proxy_result.operation.max_response_bytes,
    )


def _proxy_request(
    method: KnowledgeFSMethod,
    upstream_path: str,
) -> Response:
    """Authorize and forward the current request through the combined service use case."""
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    current_user, tenant_id = current_account_with_tenant()

    def forward(
        accept: str | None,
        content_type: str | None,
        query: bytes | None,
        body: bytes | None,
    ) -> KnowledgeFSUpstreamResponse:
        return proxy_knowledge_fs_request(
            account=current_user,
            method=method,
            path=upstream_path,
            tenant_id=tenant_id,
            accept=accept,
            content_type=content_type,
            query=query,
            body=body,
            request_headers=request.headers,
        )

    return _proxy_current_request(method=method, tenant_id=tenant_id, forward=forward)


def _proxy_authorized_request(authorization: KnowledgeFSAuthorization) -> Response:
    """Forward the current request using one previously authorized operation capability.

    Args:
        authorization: Request-scoped capability produced before billing and body parsing.

    Returns:
        The filtered response returned by KnowledgeFS.

    Raises:
        HTTPException: The integration is disabled or forwarding fails.
    """
    operation = authorization.operation
    tenant_id = authorization.tenant_id

    def forward(
        accept: str | None,
        content_type: str | None,
        query: bytes | None,
        body: bytes | None,
    ) -> KnowledgeFSUpstreamResponse:
        return proxy_authorized_knowledge_fs_request(
            authorization=authorization,
            accept=accept,
            content_type=content_type,
            query=query,
            body=body,
            request_headers=request.headers,
        )

    return _proxy_current_request(method=operation.method, tenant_id=tenant_id, forward=forward)


@_knowledge_fs_enabled
@_knowledge_fs_operation_access_required
@cloud_edition_billing_rate_limit_check("knowledge")
def _proxy_knowledge_fs_non_get(
    authorization: KnowledgeFSAuthorization,
) -> ResponseReturnValue:
    """Apply knowledge billing checks to one allowlisted non-GET operation."""
    return _proxy_authorized_request(authorization)


@bp.route(
    "/knowledge-fs/<path:upstream_path>",
    methods=["OPTIONS"],
    provide_automatic_options=False,
)
@_console_api_errors
@_knowledge_fs_enabled
def proxy_knowledge_fs_options(upstream_path: str) -> ResponseReturnValue:
    """Complete a CORS preflight only for an enabled Console operation."""
    requested_method = cast(KnowledgeFSMethod, request.headers.get("Access-Control-Request-Method", "").upper())
    try:
        get_knowledge_fs_operation(requested_method, upstream_path)
    except KnowledgeFSRouteNotAllowedError as exc:
        raise NotFound() from exc
    return Response(status=HTTPStatus.NO_CONTENT)


@bp.route(
    "/knowledge-fs/<path:upstream_path>",
    methods=["GET"],
    provide_automatic_options=False,
)
@_console_api_errors
@_knowledge_fs_enabled
@setup_required
@login_required
@account_initialization_required
def proxy_knowledge_fs_get(upstream_path: str) -> ResponseReturnValue:
    """Forward one authenticated, dataset-readable GET request.

    Args:
        upstream_path: Relative KFS path captured after the Console proxy prefix.

    Returns:
        The filtered raw KnowledgeFS response or a Console JSON error response.
    """
    if request.method != "GET":
        raise NotFound()
    return _proxy_request("GET", upstream_path)


@bp.route(
    "/knowledge-fs/<path:upstream_path>",
    methods=["DELETE", "PATCH", "POST", "PUT"],
    provide_automatic_options=False,
)
@_console_api_errors
@_knowledge_fs_enabled
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
    return _proxy_knowledge_fs_non_get(method, upstream_path)
