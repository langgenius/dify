"""Authenticated Console proxy for the allowlisted KnowledgeFS collection route.

The browser calls Dify, while KnowledgeFS remains the owner of the JSON wire
contract used by the generated frontend client. This module forwards raw JSON
and query parameters, injects no browser credentials upstream, and exposes only
safe response headers. KFS authentication failures become 502 so they cannot
trigger Dify browser-session recovery.
"""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import NoReturn

import httpx
from flask import Response, request
from flask_restx import Resource
from werkzeug.exceptions import (
    BadGateway,
    Forbidden,
    GatewayTimeout,
    RequestEntityTooLarge,
    ServiceUnavailable,
)

from controllers.console import console_ns
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
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    forward_knowledge_fs_request,
)

logger = logging.getLogger(__name__)

_MAX_PROXY_BODY_BYTES = 64 * 1024
_RESPONSE_HEADER_ALLOWLIST = ("Cache-Control", "Content-Type", "Retry-After", "X-Trace-Id")


def _translate_proxy_error(exc: Exception) -> NoReturn:
    if isinstance(exc, KnowledgeFSConfigurationError):
        logger.error("KnowledgeFS request was blocked by invalid tenant configuration")
        raise ServiceUnavailable("KnowledgeFS integration is misconfigured") from exc
    if isinstance(exc, KnowledgeFSTimeoutError):
        raise GatewayTimeout("KnowledgeFS request timed out") from exc
    if isinstance(exc, KnowledgeFSTransportError):
        logger.warning("KnowledgeFS transport request failed")
        raise BadGateway("KnowledgeFS is unavailable") from exc
    raise exc


def _request_body() -> bytes:
    body = request.stream.read(_MAX_PROXY_BODY_BYTES + 1)
    if len(body) > _MAX_PROXY_BODY_BYTES:
        raise RequestEntityTooLarge("KnowledgeFS proxy request body is too large")
    return body


def _proxy_response(upstream: httpx.Response) -> Response:
    if upstream.status_code in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
        logger.error("KnowledgeFS rejected the Dify server credential with HTTP %s", upstream.status_code)
        raise BadGateway("KnowledgeFS authentication failed")

    headers = {name: value for name in _RESPONSE_HEADER_ALLOWLIST if (value := upstream.headers.get(name)) is not None}
    return Response(upstream.content, status=upstream.status_code, headers=headers)


@console_ns.route("/knowledge-fs/knowledge-spaces")
class KnowledgeSpaceCollectionProxyApi(Resource):
    @console_ns.doc("proxy_list_knowledge_spaces")
    @console_ns.doc(description="Proxy the KnowledgeFS knowledge-space list operation")
    @console_ns.response(HTTPStatus.OK, "Proxied KnowledgeFS response")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_READONLY,
        resource_required=False,
    )
    def get(self):
        _, tenant_id = current_account_with_tenant()
        try:
            upstream = forward_knowledge_fs_request(
                method="GET",
                tenant_id=tenant_id,
                query=request.query_string,
            )
        except (KnowledgeFSConfigurationError, KnowledgeFSTimeoutError, KnowledgeFSTransportError) as exc:
            _translate_proxy_error(exc)
        return _proxy_response(upstream)

    @console_ns.doc("proxy_create_knowledge_space")
    @console_ns.doc(description="Proxy the KnowledgeFS knowledge-space create operation")
    @console_ns.response(HTTPStatus.CREATED, "Proxied KnowledgeFS response")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        resource_required=False,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        current_user, tenant_id = current_account_with_tenant()
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            upstream = forward_knowledge_fs_request(method="POST", tenant_id=tenant_id, body=_request_body())
        except (KnowledgeFSConfigurationError, KnowledgeFSTimeoutError, KnowledgeFSTransportError) as exc:
            _translate_proxy_error(exc)
        return _proxy_response(upstream)
