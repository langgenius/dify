from __future__ import annotations

import gzip
from inspect import unwrap
from unittest.mock import MagicMock

import httpx
import pytest
from flask import Flask, Response
from werkzeug.exceptions import (
    BadGateway,
    Forbidden,
    NotFound,
    RequestEntityTooLarge,
    ServiceUnavailable,
)

from controllers.console import bp
from controllers.console.knowledge_fs_proxy import (
    _console_api_errors,
    _proxy_knowledge_fs_non_get,
    _proxy_request,
    _proxy_response,
    proxy_knowledge_fs_get,
    proxy_knowledge_fs_options,
    proxy_knowledge_fs_write,
)
from controllers.console.wraps import RBACPermission
from services.knowledge_fs_proxy import (
    KnowledgeFSAccessDeniedError,
    KnowledgeFSConfigurationError,
    KnowledgeFSMethod,
    KnowledgeFSOperation,
    KnowledgeFSResponseKind,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSUpstreamResponse,
    get_knowledge_fs_operation,
)


@pytest.fixture(autouse=True)
def enable_knowledge_fs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.dify_config.KNOWLEDGE_FS_ENABLED", True)


def _upstream(
    response: httpx.Response,
    kind: KnowledgeFSResponseKind = "buffered",
    *,
    max_response_bytes: int | None = None,
) -> KnowledgeFSUpstreamResponse:
    operation = KnowledgeFSOperation(
        operation_id="testOperation",
        method="GET",
        path="test",
        response_kind=kind,
        required_scope="knowledge-spaces:read",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
        max_response_bytes=max_response_bytes
        or (64 * 1024 * 1024 if kind == "stream" else 25 * 1024 * 1024 if kind == "binary" else 1024 * 1024),
        request_headers=(),
        response_headers=(
            "content-security-policy",
            "x-content-type-options",
            "x-query-run-id",
            "x-session-id",
        ),
        response_media_types=(),
        error_status_map=((401, 502), (403, 403)),
    )
    return KnowledgeFSUpstreamResponse(response, kind, operation)


def _set_current_workspace(
    monkeypatch: pytest.MonkeyPatch,
    *,
    editor: bool = True,
    has_edit_permission: bool = True,
    admin_or_owner: bool = True,
) -> None:
    account = MagicMock(
        id="account-1",
        has_edit_permission=has_edit_permission,
        is_admin_or_owner=admin_or_owner,
        is_dataset_editor=editor,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )


def _bypass_policy_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy._proxy_knowledge_fs_non_get",
        unwrap(_proxy_knowledge_fs_non_get),
    )


def test_console_blueprint_registers_generic_knowledge_fs_routes() -> None:
    app = Flask("knowledge-fs-route-registration")
    app.register_blueprint(bp)
    adapter = app.url_map.bind("localhost")

    get_endpoint, get_values = adapter.match(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="GET",
    )
    assert get_endpoint.endswith("proxy_knowledge_fs_get")
    assert get_values == {"upstream_path": "knowledge-spaces"}
    for method in ("DELETE", "PATCH", "POST", "PUT"):
        write_endpoint, write_values = adapter.match(
            "/console/api/knowledge-fs/knowledge-spaces/space-1",
            method=method,
        )
        assert write_endpoint.endswith("proxy_knowledge_fs_write")
        assert write_values == {"upstream_path": "knowledge-spaces/space-1"}
    options_endpoint, options_values = adapter.match(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="OPTIONS",
    )
    assert options_endpoint.endswith("proxy_knowledge_fs_options")
    assert options_values == {"upstream_path": "knowledge-spaces"}


def test_proxy_options_does_not_require_an_authenticated_account(app: Flask) -> None:
    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="OPTIONS",
        headers={"Access-Control-Request-Method": "GET"},
    ):
        response = app.make_response(proxy_knowledge_fs_options("knowledge-spaces"))

    assert response.status_code == 204


def test_proxy_options_is_hidden_when_knowledge_fs_is_disabled(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.dify_config.KNOWLEDGE_FS_ENABLED", False)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="OPTIONS",
        headers={"Access-Control-Request-Method": "GET"},
    ):
        response = app.make_response(proxy_knowledge_fs_options("knowledge-spaces"))

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("upstream_path", "requested_method"),
    [
        ("unregistered", "GET"),
        ("knowledge-spaces", "DELETE"),
        ("knowledge-spaces", ""),
    ],
)
def test_proxy_options_hides_unregistered_operations(
    app: Flask,
    upstream_path: str,
    requested_method: str,
) -> None:
    headers = {"Access-Control-Request-Method": requested_method} if requested_method else None
    with app.test_request_context(
        f"/console/api/knowledge-fs/{upstream_path}",
        method="OPTIONS",
        headers=headers,
    ):
        response = app.make_response(proxy_knowledge_fs_options(upstream_path))

    assert response.status_code == 404


def test_proxy_is_hidden_when_knowledge_fs_is_disabled(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.dify_config.KNOWLEDGE_FS_ENABLED", False)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces", method="GET"):
        with pytest.raises(NotFound):
            _proxy_request("GET", "knowledge-spaces")


@pytest.mark.parametrize(
    ("route", "method"),
    [
        (proxy_knowledge_fs_get, "GET"),
        (proxy_knowledge_fs_write, "POST"),
    ],
)
def test_proxy_routes_are_hidden_before_downstream_work_when_disabled(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    route,
    method: KnowledgeFSMethod,
) -> None:
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.dify_config.KNOWLEDGE_FS_ENABLED", False)
    proxy_request = MagicMock()
    proxy_non_get = MagicMock()
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy._proxy_request", proxy_request)
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy._proxy_knowledge_fs_non_get", proxy_non_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces", method=method):
        response = app.make_response(route("knowledge-spaces"))

    assert response.status_code == 404
    proxy_request.assert_not_called()
    proxy_non_get.assert_not_called()


@pytest.mark.parametrize("method", ["HEAD", "OPTIONS"])
def test_generic_get_hides_unregistered_methods(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
) -> None:
    proxy = MagicMock(return_value=Response(status=200))
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy._proxy_request", proxy)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method=method,
    ):
        with pytest.raises(NotFound):
            route("knowledge-spaces")

    proxy.assert_not_called()


@pytest.mark.parametrize(
    ("route", "method", "path", "permission"),
    [
        (proxy_knowledge_fs_get, "GET", "knowledge-spaces", RBACPermission.DATASET_READONLY),
        (
            proxy_knowledge_fs_write,
            "POST",
            "knowledge-spaces",
            RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        ),
    ],
)
def test_generic_routes_delegate_to_the_authorized_service_use_case(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    route,
    method: KnowledgeFSMethod,
    path: str,
    permission: RBACPermission,
) -> None:
    response_kind: KnowledgeFSResponseKind = "buffered"
    upstream = httpx.Response(
        200,
        content=b"asset" if response_kind == "binary" else b"{}",
        headers={"Content-Type": "application/octet-stream" if response_kind == "binary" else "application/json"},
    )
    proxy = MagicMock(return_value=_upstream(upstream, response_kind))
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        proxy,
    )
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    raw_route = unwrap(route)

    with app.test_request_context(f"/console/api/knowledge-fs/{path}", method=method, data=b"{}"):
        response = raw_route(path)

    assert isinstance(response, Response)
    assert proxy.call_args.kwargs["account"].id == "account-1"
    assert proxy.call_args.kwargs["tenant_id"] == "tenant-1"
    assert proxy.call_args.kwargs["method"] == method
    assert proxy.call_args.kwargs["path"] == path
    assert get_knowledge_fs_operation(method, path).rbac_permission == permission


def test_read_post_applies_knowledge_rate_limit_once(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("controllers.common.wraps.dify_config.RBAC_ENABLED", False)
    account = MagicMock(id="account-1", is_dataset_editor=True)

    def current_workspace() -> tuple[MagicMock, str]:
        return account, "tenant-1"

    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.current_account_with_tenant", current_workspace)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", current_workspace)
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.RBACService.CheckAccess.check",
        MagicMock(return_value=True),
    )
    monkeypatch.setattr(
        "controllers.console.wraps.FeatureService.get_knowledge_rate_limit",
        MagicMock(return_value=MagicMock(enabled=True, limit=10)),
    )
    zadd = MagicMock()
    monkeypatch.setattr("controllers.console.wraps.redis_client.zadd", zadd)
    monkeypatch.setattr("controllers.console.wraps.redis_client.zremrangebyscore", MagicMock())
    monkeypatch.setattr("controllers.console.wraps.redis_client.zcard", MagicMock(return_value=1))
    proxy = MagicMock(return_value=Response(status=200))
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy._proxy_request", proxy)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces", method="POST"):
        response = _proxy_knowledge_fs_non_get("POST", "knowledge-spaces")

    assert isinstance(response, Response)
    zadd.assert_called_once()
    proxy.assert_called_once_with("POST", "knowledge-spaces")


def test_denied_write_does_not_consume_the_workspace_rate_limit(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False)

    def current_workspace() -> tuple[MagicMock, str]:
        return account, "tenant-1"

    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.current_account_with_tenant",
        current_workspace,
    )
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", current_workspace)
    monkeypatch.setattr(
        "controllers.console.wraps.FeatureService.get_knowledge_rate_limit",
        MagicMock(return_value=MagicMock(enabled=True, limit=10)),
    )
    zadd = MagicMock()
    monkeypatch.setattr("controllers.console.wraps.redis_client.zadd", zadd)
    upstream_request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", upstream_request)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"{}",
        content_type="application/json",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces")

    zadd.assert_not_called()
    upstream_request.assert_not_called()


def test_generic_get_forwards_path_query_and_raw_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock(
        return_value=_upstream(
            httpx.Response(
                200,
                content=gzip.compress(b'{"items":[],"nextCursor":null}'),
                headers={
                    "Cache-Control": "no-store",
                    "Content-Encoding": "gzip",
                    "Content-Disposition": 'attachment; filename="result.json"',
                    "Content-Type": "application/json",
                    "Retry-After": "3",
                    "Set-Cookie": "kfs=secret",
                    "X-Trace-Id": "trace-1",
                },
            )
        )
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        query_string=[("limit", "20"), ("cursor", "first"), ("cursor", "second")],
    ):
        response = route("knowledge-spaces")

    request = forward.call_args.kwargs
    assert request["account"].id == "account-1"
    assert request["method"] == "GET"
    assert request["path"] == "knowledge-spaces"
    assert request["tenant_id"] == "tenant-1"
    assert request["accept"] is None
    assert request["content_type"] is None
    assert request["query"] == b"limit=20&cursor=first&cursor=second"
    assert request["body"] is None
    assert isinstance(response, Response)
    assert response.status_code == 200
    assert response.get_json() == {"items": [], "nextCursor": None}
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Disposition"] == 'attachment; filename="result.json"'
    assert response.headers["Retry-After"] == "3"
    assert response.headers["X-Trace-Id"] == "trace-1"
    assert "Content-Encoding" not in response.headers
    assert "Set-Cookie" not in response.headers


def test_generic_write_forwards_path_raw_body_and_current_tenant(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    method = "POST"
    path = "knowledge-spaces"
    forward = MagicMock(
        return_value=_upstream(
            httpx.Response(
                201,
                content=b'{"id":"space-1","tenantId":"tenant-1"}',
                headers={"Content-Type": "application/json"},
            )
        )
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    with app.test_request_context(
        f"/console/api/knowledge-fs/{path}",
        method=method,
        data=body,
        content_type="application/json",
    ):
        response = route(path)

    request = forward.call_args.kwargs
    assert request["account"].id == "account-1"
    assert request["method"] == method
    assert request["path"] == path
    assert request["tenant_id"] == "tenant-1"
    assert request["accept"] is None
    assert request["content_type"] == "application/json"
    assert request["query"] is None
    assert request["body"] == body
    assert isinstance(response, Response)
    assert response.status_code == 201
    assert response.get_json()["tenantId"] == "tenant-1"


def test_generic_write_forwards_contract_declared_request_headers(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock(
        return_value=_upstream(
            httpx.Response(202, content=b'{"status":"accepted"}', headers={"Content-Type": "application/json"})
        )
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)
    body = b'{"name":"Product docs"}'

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=body,
        content_type="application/json",
        headers={"X-Trace-Id": "trace-1"},
    ):
        response = route("knowledge-spaces")

    assert isinstance(response, Response)
    assert response.status_code == 202
    assert forward.call_args.kwargs["request_headers"].get("X-Trace-Id") == "trace-1"


def test_contract_response_headers_cannot_bypass_the_proxy_denylist() -> None:
    denied_headers = (
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    )
    upstream = httpx.Response(
        200,
        content=b"{}",
        headers=dict.fromkeys(denied_headers, "blocked"),
    )

    response = _proxy_response(
        _upstream(upstream),
        tenant_id="tenant-1",
        contract_response_headers=denied_headers,
        max_response_bytes=1024 * 1024,
    )

    for name in denied_headers:
        assert name not in response.headers


def test_contract_response_headers_forward_binary_hardening_headers() -> None:
    upstream = httpx.Response(
        200,
        content=b"asset",
        headers={
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
        },
    )

    response = _proxy_response(
        _upstream(upstream, "binary"),
        tenant_id="tenant-1",
        contract_response_headers=("content-security-policy", "x-content-type-options"),
        max_response_bytes=25 * 1024 * 1024,
    )

    assert response.headers["Content-Security-Policy"] == "sandbox; default-src 'none'"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_authorized_service_denial_is_exposed_as_forbidden(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSAccessDeniedError("workspace access denied")),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(Forbidden):
            route("knowledge-spaces")


def test_generic_post_rejects_oversized_body(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    monkeypatch.setattr("controllers.console.knowledge_fs_proxy._MAX_PROXY_BODY_BYTES", 8)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"x" * 9,
        content_type="application/json",
    ):
        with pytest.raises(RequestEntityTooLarge):
            route("knowledge-spaces")

    forward.assert_not_called()


def test_server_credential_rejection_is_not_exposed_as_browser_auth_failure(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        MagicMock(
            return_value=_upstream(
                httpx.Response(
                    401,
                    content=b'{"error":"invalid server credential"}',
                    headers={"Content-Type": "application/json", "WWW-Authenticate": "Bearer"},
                )
            )
        ),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(BadGateway, match="authentication failed"):
            route("knowledge-spaces")


def test_resource_authorization_rejection_is_exposed_as_forbidden(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        MagicMock(
            return_value=_upstream(
                httpx.Response(
                    403,
                    content=b'{"error":"resource access denied"}',
                    headers={"Content-Type": "application/json"},
                )
            )
        ),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(Forbidden):
            route("knowledge-spaces")


def test_contract_response_headers_are_deduplicated_case_insensitively() -> None:
    upstream = httpx.Response(
        200,
        content=b"asset",
        headers={
            "Cache-Control": "private",
            "Content-Disposition": 'inline; filename="asset.png"',
            "Content-Type": "image/png",
        },
    )

    response = _proxy_response(
        _upstream(upstream, "binary"),
        tenant_id="tenant-1",
        contract_response_headers=("cache-control", "content-disposition"),
        max_response_bytes=25 * 1024 * 1024,
    )

    assert response.headers.getlist("Cache-Control") == ["private"]
    assert response.headers.getlist("Content-Disposition") == ['inline; filename="asset.png"']


def test_configuration_error_is_reported_as_unavailable(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSConfigurationError("missing token")),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(ServiceUnavailable, match="misconfigured"):
            route("knowledge-spaces")


def test_disallowed_kfs_route_is_hidden_as_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.proxy_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSRouteNotAllowedError("blocked")),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/openapi.json"):
        with pytest.raises(NotFound):
            route("openapi.json")


@pytest.mark.parametrize("method", ["PATCH", "POST"])
def test_disallowed_non_get_route_is_hidden_as_not_found(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
) -> None:
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context("/console/api/knowledge-fs/not-a-route", method=method):
        with pytest.raises(NotFound):
            route("not-a-route")


def test_raw_route_uses_console_json_error_handler(app: Flask) -> None:
    def forbidden(_upstream_path: str) -> Response:
        raise Forbidden("blocked")

    route = _console_api_errors(forbidden)
    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        response = app.make_response(route("knowledge-spaces"))

    assert response.status_code == 403
    assert response.is_json
    assert response.get_json() == {"code": "forbidden", "message": "blocked", "status": 403}
