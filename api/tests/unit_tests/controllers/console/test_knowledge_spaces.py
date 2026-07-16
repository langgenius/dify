from __future__ import annotations

import gzip
from inspect import unwrap
from unittest.mock import MagicMock

import httpx
import pytest
from flask import Flask
from werkzeug.exceptions import BadGateway, Forbidden, RequestEntityTooLarge, ServiceUnavailable

from controllers.console.knowledge_spaces.spaces import KnowledgeSpaceCollectionProxyApi
from services.knowledge_fs_proxy import KnowledgeFSConfigurationError


def test_get_reports_unconfigured_proxy_as_unavailable(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSConfigurationError("connection configuration is incomplete")),
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(ServiceUnavailable, match="misconfigured"):
            method(KnowledgeSpaceCollectionProxyApi())


def test_get_enforces_workspace_level_dataset_read_rbac(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    method = KnowledgeSpaceCollectionProxyApi.get
    for _ in range(3):
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
            method(KnowledgeSpaceCollectionProxyApi())

    assert enforce.call_args.kwargs["resource_required"] is False


def test_get_forwards_query_and_returns_raw_kfs_response(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        forward,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.get)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        query_string=[("limit", "20"), ("cursor", "first"), ("cursor", "second")],
    ):
        response = method(KnowledgeSpaceCollectionProxyApi())

    forward.assert_called_once_with(
        method="GET",
        tenant_id="tenant-1",
        query=b"limit=20&cursor=first&cursor=second",
    )
    assert response.status_code == 200
    assert response.get_json() == {"items": [], "nextCursor": None}
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Retry-After"] == "3"
    assert response.headers["X-Trace-Id"] == "trace-1"
    assert "Content-Encoding" not in response.headers
    assert "Set-Cookie" not in response.headers


def test_post_forwards_raw_body_and_current_tenant(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock(
        return_value=httpx.Response(
            201,
            content=b'{"id":"space-1","tenantId":"tenant-1"}',
            headers={"Content-Type": "application/json"},
        )
    )
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        forward,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.post)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=body,
        content_type="application/json",
    ):
        response = method(KnowledgeSpaceCollectionProxyApi())

    forward.assert_called_once_with(method="POST", tenant_id="tenant-1", body=body)
    assert response.status_code == 201
    assert response.get_json()["tenantId"] == "tenant-1"


def test_post_rejects_oversized_body_before_proxying(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    forward = MagicMock()
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        forward,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.post)

    with app.test_request_context(
        "/console/api/knowledge-fs/knowledge-spaces",
        method="POST",
        data=b"x" * (64 * 1024 + 1),
        content_type="application/json",
    ):
        with pytest.raises(RequestEntityTooLarge):
            method(KnowledgeSpaceCollectionProxyApi())

    forward.assert_not_called()


@pytest.mark.parametrize("status_code", [401, 403])
def test_server_credential_rejection_is_not_exposed_as_browser_auth_failure(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    forward = MagicMock(
        return_value=httpx.Response(
            status_code,
            content=b'{"error":"invalid server credential"}',
            headers={"Content-Type": "application/json", "WWW-Authenticate": "Bearer"},
        )
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        forward,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(BadGateway, match="authentication failed"):
            method(KnowledgeSpaceCollectionProxyApi())


def test_partial_configuration_is_reported_as_unavailable(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.forward_knowledge_fs_request",
        MagicMock(side_effect=KnowledgeFSConfigurationError("missing token")),
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceCollectionProxyApi.get)

    with app.test_request_context("/console/api/knowledge-fs/knowledge-spaces"):
        with pytest.raises(ServiceUnavailable, match="misconfigured"):
            method(KnowledgeSpaceCollectionProxyApi())
