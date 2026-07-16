from __future__ import annotations

import gzip
from collections.abc import Iterator
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
    _proxy_knowledge_fs_mutation,
    _proxy_knowledge_fs_read_operation,
    _proxy_response,
    proxy_knowledge_fs_get,
    proxy_knowledge_fs_write,
)
from controllers.console.wraps import RBACPermission
from core.helper import ssrf_proxy
from services.knowledge_fs_proxy import (
    KnowledgeFSConfigurationError,
    KnowledgeFSResponseKind,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSUpstreamResponse,
)


def _upstream(
    response: httpx.Response,
    kind: KnowledgeFSResponseKind = "buffered",
) -> KnowledgeFSUpstreamResponse:
    return KnowledgeFSUpstreamResponse(response, kind)


class _EventStream(httpx.SyncByteStream):
    def __init__(self, content: bytes) -> None:
        self._content = content

    def __iter__(self) -> Iterator[bytes]:
        yield self._content


class _FailingEventStream(httpx.SyncByteStream):
    def __iter__(self) -> Iterator[bytes]:
        yield b"event: delta\ndata: first\n\n"
        request = httpx.Request("POST", "http://knowledge-fs.test/queries")
        raise httpx.ReadTimeout("stream timed out", request=request)


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
        "controllers.console.knowledge_fs_proxy._proxy_knowledge_fs_read_operation",
        unwrap(_proxy_knowledge_fs_read_operation),
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy._proxy_knowledge_fs_mutation",
        unwrap(_proxy_knowledge_fs_mutation),
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


@pytest.mark.parametrize(
    ("route", "method", "path", "permission"),
    [
        (proxy_knowledge_fs_get, "GET", "knowledge-spaces", RBACPermission.DATASET_READONLY),
        (
            proxy_knowledge_fs_write,
            "POST",
            "queries",
            RBACPermission.DATASET_READONLY,
        ),
        (
            proxy_knowledge_fs_write,
            "POST",
            "knowledge-spaces",
            RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        ),
        (proxy_knowledge_fs_write, "DELETE", "knowledge-spaces/space-1", RBACPermission.DATASET_EDIT),
        (
            proxy_knowledge_fs_write,
            "PATCH",
            "knowledge-spaces/space-1/access-policy",
            RBACPermission.DATASET_ACCESS_CONFIG,
        ),
        (
            proxy_knowledge_fs_write,
            "POST",
            "knowledge-spaces/space-1/api-keys",
            RBACPermission.DATASET_API_KEY_MANAGE,
        ),
        (
            proxy_knowledge_fs_get,
            "GET",
            "knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
            RBACPermission.DATASET_DOCUMENT_DOWNLOAD,
        ),
        (
            proxy_knowledge_fs_write,
            "POST",
            "knowledge-spaces/space-1/source-connections",
            RBACPermission.DATASET_EXTERNAL_CONNECT,
        ),
    ],
)
def test_generic_routes_enforce_contract_specific_workspace_rbac(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    route,
    method: str,
    path: str,
    permission: RBACPermission,
) -> None:
    response_kind: KnowledgeFSResponseKind = (
        "binary" if permission == RBACPermission.DATASET_DOCUMENT_DOWNLOAD else "buffered"
    )
    upstream = httpx.Response(
        200,
        content=b"asset" if response_kind == "binary" else b"{}",
        headers={"Content-Type": "application/octet-stream" if response_kind == "binary" else "application/json"},
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(return_value=_upstream(upstream, response_kind)),
    )
    authorize = MagicMock()
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.authorize_knowledge_fs_request", authorize)
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    raw_route = unwrap(route)

    with app.test_request_context(f"/console/api/knowledge-fs/{path}", method=method, data=b"{}"):
        response = raw_route(path)

    assert isinstance(response, Response)
    assert authorize.call_args.kwargs["tenant_id"] == "tenant-1"
    assert authorize.call_args.kwargs["method"] == method
    assert authorize.call_args.kwargs["operation"].rbac_permission == permission.value


def test_read_post_applies_knowledge_rate_limit_once(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("controllers.common.wraps.dify_config.RBAC_ENABLED", False)
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
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

    with app.test_request_context("/console/api/knowledge-fs/queries", method="POST"):
        response = _proxy_knowledge_fs_read_operation("POST", "queries")

    assert isinstance(response, Response)
    zadd.assert_called_once()
    proxy.assert_called_once_with("POST", "queries")


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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        query_string=[("limit", "20"), ("cursor", "first"), ("cursor", "second")],
    ):
        response = route("knowledge-spaces")

    forward.assert_called_once_with(
        account_id="account-1",
        method="GET",
        path="knowledge-spaces",
        tenant_id="tenant-1",
        accept=None,
        content_type=None,
        query=b"limit=20&cursor=first&cursor=second",
        body=None,
        request_headers={},
    )
    assert isinstance(response, Response)
    assert response.status_code == 200
    assert response.get_json() == {"items": [], "nextCursor": None}
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Disposition"] == 'attachment; filename="result.json"'
    assert response.headers["Retry-After"] == "3"
    assert response.headers["X-Trace-Id"] == "trace-1"
    assert "Content-Encoding" not in response.headers
    assert "Set-Cookie" not in response.headers


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("DELETE", "knowledge-spaces/space-1"),
        ("PATCH", "knowledge-spaces/space-1"),
        ("POST", "knowledge-spaces"),
        ("PUT", "knowledge-spaces/space-1/retrieval-profile"),
    ],
)
def test_generic_write_forwards_path_raw_body_and_current_tenant(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
) -> None:
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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
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

    forward.assert_called_once_with(
        account_id="account-1",
        method=method,
        path=path,
        tenant_id="tenant-1",
        accept=None,
        content_type="application/json",
        query=None,
        body=body,
        request_headers={},
    )
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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)
    body = b'{"challenge":"delete-space","expectedRevision":1}'

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces/space-1",
        method="DELETE",
        data=body,
        content_type="application/json",
        headers={"Idempotency-Key": "delete-space-1"},
    ):
        response = route("knowledge-spaces/space-1")

    assert isinstance(response, Response)
    assert response.status_code == 202
    assert forward.call_args.kwargs["request_headers"] == {"idempotency-key": "delete-space-1"}


def test_processing_events_forwards_last_event_id(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream = httpx.Response(
        200,
        stream=_EventStream(b"event: done\ndata: {}\n\n"),
        headers={"Content-Type": "text/event-stream"},
    )
    forward = MagicMock(return_value=_upstream(upstream, "stream"))
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request", forward)
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)
    path = "knowledge-spaces/space-1/documents/document-1/processing-tasks/task-1/events"

    with app.test_request_context(
        f"/console/api/knowledge-fs/{path}",
        headers={"Last-Event-ID": "42"},
    ):
        response = route(path)
        assert isinstance(response, Response)
        response.close()

    assert forward.call_args.kwargs["request_headers"] == {"last-event-id": "42"}


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


def test_generic_post_rejects_non_editor(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch, editor=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"{}",
        content_type="application/json",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces")

    forward.assert_not_called()


def test_api_key_mutation_requires_workspace_edit_permission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock()
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request", forward)
    _set_current_workspace(monkeypatch, has_edit_permission=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces/space-1/api-keys",
        method="POST",
        data=b"{}",
        content_type="application/json",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces/space-1/api-keys")

    forward.assert_not_called()


def test_api_key_deletion_requires_workspace_admin_or_owner(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock()
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request", forward)
    _set_current_workspace(monkeypatch, admin_or_owner=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces/space-1/api-keys/key-1",
        method="DELETE",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces/space-1/api-keys/key-1")

    forward.assert_not_called()


def test_access_policy_mutation_requires_workspace_admin_or_owner(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock()
    monkeypatch.setattr("controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request", forward)
    _set_current_workspace(monkeypatch, admin_or_owner=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces/space-1/access-policy",
        method="PATCH",
        data=b"{}",
        content_type="application/json",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces/space-1/access-policy")

    forward.assert_not_called()


def test_read_post_allows_non_editor_and_streams_sse(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream = httpx.Response(
        200,
        stream=_EventStream(b"event: delta\ndata: first\n\nevent: done\ndata: {}\n\n"),
        headers={
            "Cache-Control": "no-store",
            "Content-Type": "text/event-stream",
            "X-Query-Run-Id": "query-run-1",
            "X-Session-Id": "session-1",
        },
    )
    forward = MagicMock(return_value=_upstream(upstream, "stream"))
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch, editor=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context(
        "/console/api/knowledge-fs/queries",
        method="POST",
        data=b'{"knowledgeSpaceId":"space-1","query":"hello"}',
        content_type="application/json",
    ):
        response = route("queries")
        assert isinstance(response, Response)
        assert response.get_data() == b"event: delta\ndata: first\n\nevent: done\ndata: {}\n\n"

    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/event-stream")
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Query-Run-Id"] == "query-run-1"
    assert response.headers["X-Session-Id"] == "session-1"
    assert upstream.is_closed
    forward.assert_called_once()


def test_unconsumed_sse_response_closes_upstream(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream = httpx.Response(
        200,
        stream=_EventStream(b"event: done\ndata: {}\n\n"),
        headers={"Content-Type": "text/event-stream"},
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(return_value=_upstream(upstream, "stream")),
    )
    _set_current_workspace(monkeypatch, editor=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context("/console/api/knowledge-fs/queries", method="POST", data=b"{}"):
        response = route("queries")
        assert isinstance(response, Response)
        response.close()

    assert upstream.is_closed


def test_sse_response_uses_the_generated_operation_limit(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream = httpx.Response(
        200,
        stream=_EventStream(b"event: done\ndata: {}\n\n"),
        headers={"Content-Type": "text/event-stream"},
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(return_value=_upstream(upstream, "stream")),
    )
    operation = MagicMock(
        access="read",
        rbac_permission="dataset_readonly",
        max_response_bytes=1,
        request_headers=(),
        response_headers=(),
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.get_knowledge_fs_operation",
        lambda _method, _path: operation,
    )
    _set_current_workspace(monkeypatch, editor=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context("/console/api/knowledge-fs/queries", method="POST", data=b"{}"):
        response = route("queries")
        assert isinstance(response, Response)
        with pytest.raises(ssrf_proxy.ResponseTooLargeError, match="response exceeded 1 bytes"):
            response.get_data()

    assert upstream.is_closed


def test_sse_transport_failure_is_visible_to_the_client(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream = httpx.Response(
        200,
        stream=_FailingEventStream(),
        headers={"Content-Type": "text/event-stream"},
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(return_value=_upstream(upstream, "stream")),
    )
    _set_current_workspace(monkeypatch, editor=False)
    _bypass_policy_wrappers(monkeypatch)
    route = unwrap(proxy_knowledge_fs_write)

    with app.test_request_context("/console/api/knowledge-fs/queries", method="POST", data=b"{}"):
        response = route("queries")
        assert isinstance(response, Response)
        with pytest.raises(httpx.ReadTimeout, match="stream timed out"):
            response.get_data()

    assert upstream.is_closed


def test_generic_post_rejects_oversized_body(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
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
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSConfigurationError("missing token")),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(ServiceUnavailable, match="misconfigured"):
            route("knowledge-spaces")


def test_disallowed_kfs_route_is_hidden_as_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
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
    method: str,
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
