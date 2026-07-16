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
    proxy_knowledge_fs_get,
    proxy_knowledge_fs_post,
)
from controllers.console.wraps import RBACPermission
from services.knowledge_fs_proxy import KnowledgeFSConfigurationError, KnowledgeFSRouteNotAllowedError


def _set_current_workspace(monkeypatch: pytest.MonkeyPatch, *, editor: bool = True) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.current_account_with_tenant",
        lambda: (MagicMock(id="account-1", is_dataset_editor=editor), "tenant-1"),
    )


def test_console_blueprint_registers_generic_knowledge_fs_routes() -> None:
    app = Flask("knowledge-fs-route-registration")
    app.register_blueprint(bp)
    adapter = app.url_map.bind("localhost")

    get_endpoint, get_values = adapter.match(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="GET",
    )
    post_endpoint, post_values = adapter.match(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
    )

    assert get_endpoint.endswith("proxy_knowledge_fs_get")
    assert post_endpoint.endswith("proxy_knowledge_fs_post")
    assert get_values == {"upstream_path": "knowledge-spaces"}
    assert post_values == {"upstream_path": "knowledge-spaces"}


@pytest.mark.parametrize(
    ("route", "permission"),
    [
        (proxy_knowledge_fs_get, RBACPermission.DATASET_READONLY),
        (proxy_knowledge_fs_post, RBACPermission.DATASET_CREATE_AND_MANAGEMENT),
    ],
)
def test_generic_routes_enforce_method_specific_workspace_rbac(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    route,
    permission: RBACPermission,
) -> None:
    method = route
    for _ in range(4):
        method = method.__wrapped__

    monkeypatch.setattr("controllers.common.wraps.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr(
        "controllers.common.wraps.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    enforce = MagicMock(side_effect=Forbidden())
    monkeypatch.setattr("controllers.common.wraps.enforce_rbac_access", enforce)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(Forbidden):
            method("knowledge-spaces")

    assert enforce.call_args.kwargs["scene"] == permission
    assert enforce.call_args.kwargs["resource_required"] is False


def test_generic_get_forwards_path_query_and_raw_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock(
        return_value=httpx.Response(
            200,
            content=gzip.compress(b'{"items":[],"nextCursor":null}'),
            headers={
                "Cache-Control": "no-store",
                "Content-Encoding": "gzip",
                "Content-Type": "application/json",
                "Retry-After": "3",
                "Set-Cookie": "kfs=secret",
                "X-Trace-Id": "trace-1",
            },
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
        method="GET",
        path="knowledge-spaces",
        tenant_id="tenant-1",
        query=b"limit=20&cursor=first&cursor=second",
        body=None,
    )
    assert isinstance(response, Response)
    assert response.status_code == 200
    assert response.get_json() == {"items": [], "nextCursor": None}
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Retry-After"] == "3"
    assert response.headers["X-Trace-Id"] == "trace-1"
    assert "Content-Encoding" not in response.headers
    assert "Set-Cookie" not in response.headers


def test_generic_post_forwards_path_raw_body_and_current_tenant(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forward = MagicMock(
        return_value=httpx.Response(
            201,
            content=b'{"id":"space-1","tenantId":"tenant-1"}',
            headers={"Content-Type": "application/json"},
        )
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_post)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=body,
        content_type="application/json",
    ):
        response = route("knowledge-spaces")

    forward.assert_called_once_with(
        method="POST",
        path="knowledge-spaces",
        tenant_id="tenant-1",
        query=None,
        body=body,
    )
    assert isinstance(response, Response)
    assert response.status_code == 201
    assert response.get_json()["tenantId"] == "tenant-1"


def test_generic_post_rejects_non_editor(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch, editor=False)
    route = unwrap(proxy_knowledge_fs_post)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"{}",
        content_type="application/json",
    ):
        with pytest.raises(Forbidden):
            route("knowledge-spaces")

    forward.assert_not_called()


def test_generic_post_rejects_oversized_body(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        forward,
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_post)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"x" * (64 * 1024 + 1),
        content_type="application/json",
    ):
        with pytest.raises(RequestEntityTooLarge):
            route("knowledge-spaces")

    forward.assert_not_called()


@pytest.mark.parametrize("status_code", [401, 403])
def test_server_credential_rejection_is_not_exposed_as_browser_auth_failure(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_fs_proxy.forward_knowledge_fs_request",
        MagicMock(
            return_value=httpx.Response(
                status_code,
                content=b'{"error":"invalid server credential"}',
                headers={"Content-Type": "application/json", "WWW-Authenticate": "Bearer"},
            )
        ),
    )
    _set_current_workspace(monkeypatch)
    route = unwrap(proxy_knowledge_fs_get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(BadGateway, match="authentication failed"):
            route("knowledge-spaces")


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


def test_raw_route_uses_console_json_error_handler(app: Flask) -> None:
    def forbidden(_upstream_path: str) -> Response:
        raise Forbidden("blocked")

    route = _console_api_errors(forbidden)
    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        response = app.make_response(route("knowledge-spaces"))

    assert response.status_code == 403
    assert response.is_json
    assert response.get_json() == {"code": "forbidden", "message": "blocked", "status": 403}
