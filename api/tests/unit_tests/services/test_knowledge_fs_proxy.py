from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import jwt
import pytest
from pydantic import SecretStr

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.knowledge_fs_contract_routes import KNOWLEDGE_FS_CONTRACT_OPERATIONS
from services.knowledge_fs_proxy import (
    KnowledgeFSAccessDeniedError,
    KnowledgeFSConfigurationError,
    KnowledgeFSMethod,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    authorize_knowledge_fs_request,
    forward_knowledge_fs_request,
    get_knowledge_fs_operation,
)

_JWT_SECRET = "production-secret-with-at-least-32-bytes"


def _set_config(
    monkeypatch: pytest.MonkeyPatch,
    *,
    base_url: str | None = "http://knowledge-fs.test",
    timeout_seconds: float = 7.5,
    sse_read_timeout_seconds: float = 300.0,
    jwt_secret: str | None = _JWT_SECRET,
) -> None:
    values = {
        "KNOWLEDGE_FS_BASE_URL": base_url,
        "KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS": sse_read_timeout_seconds,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": timeout_seconds,
        "KNOWLEDGE_FS_JWT_SECRET": SecretStr(jwt_secret) if jwt_secret is not None else None,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_fs_proxy.dify_config.{name}", value, raising=False)


def test_unconfigured_kfs_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url=None, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    request.assert_not_called()


def test_partial_configuration_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    request.assert_not_called()


def test_get_forwards_raw_query(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url="http://knowledge-fs.test/gateway")
    response = httpx.Response(200, content=b'{"items":[]}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="GET",
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        query=b"limit=20&cursor=first&cursor=second",
    )

    assert result.response.content == response.content
    assert result.response_kind == "buffered"
    request.assert_called_once()
    assert request.call_args.kwargs["method"] == "GET"
    assert request.call_args.kwargs["url"] == "http://knowledge-fs.test/gateway/knowledge-spaces"
    assert request.call_args.kwargs["params"] == b"limit=20&cursor=first&cursor=second"
    assert request.call_args.kwargs["content"] is None
    assert request.call_args.kwargs["headers"]["Accept"] == "application/json"
    assert request.call_args.kwargs["headers"]["Accept-Encoding"] == "identity"
    assert request.call_args.kwargs["headers"]["Authorization"].startswith("Bearer ")
    assert request.call_args.kwargs["timeout"] == 7.5
    assert request.call_args.kwargs["follow_redirects"] is False
    assert request.call_args.kwargs["max_retries"] == 0
    assert "max_response_bytes" not in request.call_args.kwargs
    assert request.call_args.kwargs["stream_response"] is True


def test_post_forwards_raw_json_without_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(201, content=b'{"id":"space-1"}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="POST",
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        body=body,
    )

    assert result.response.content == response.content
    assert result.response_kind == "buffered"
    request.assert_called_once()
    assert request.call_args.kwargs["method"] == "POST"
    assert request.call_args.kwargs["url"] == "http://knowledge-fs.test/knowledge-spaces"
    assert request.call_args.kwargs["params"] is None
    assert request.call_args.kwargs["content"] == body
    assert request.call_args.kwargs["headers"]["Accept"] == "application/json"
    assert request.call_args.kwargs["headers"]["Accept-Encoding"] == "identity"
    assert request.call_args.kwargs["headers"]["Authorization"].startswith("Bearer ")
    assert request.call_args.kwargs["headers"]["Content-Type"] == "application/json"
    assert request.call_args.kwargs["timeout"] == 7.5
    assert request.call_args.kwargs["follow_redirects"] is False
    assert request.call_args.kwargs["max_retries"] == 0
    assert "max_response_bytes" not in request.call_args.kwargs
    assert request.call_args.kwargs["stream_response"] is True


def test_multipart_upload_preserves_content_negotiation(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(
        202,
        content=b'{"status":"accepted"}',
        headers={"Content-Type": "application/json"},
    )
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)
    content_type = "multipart/form-data; boundary=knowledge-fs-upload"

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="POST",
        path="knowledge-spaces/space-1/documents",
        tenant_id="tenant-dev",
        accept="application/json",
        content_type=content_type,
        body=b"multipart-body",
    )

    assert result.response.content == response.content
    assert request.call_args.kwargs["headers"]["Accept"] == "application/json"
    assert request.call_args.kwargs["headers"]["Content-Type"] == content_type


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("DELETE", "knowledge-spaces/space-1"),
        ("GET", "source-providers"),
        ("PATCH", "knowledge-spaces/space-1"),
        ("POST", "knowledge-spaces/space-1/source-connections"),
        ("PUT", "knowledge-spaces/space-1/retrieval-profile"),
    ],
)
def test_generated_contract_routes_are_forwarded(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    path: str,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(account_id="account-dev", method=method, path=path, tenant_id="tenant-dev")

    assert result.response.content == response.content
    assert request.call_args.kwargs["method"] == method
    assert request.call_args.kwargs["url"] == f"http://knowledge-fs.test/{path}"


def test_generated_proxy_allowlist_contains_every_contract_operation() -> None:
    assert len(KNOWLEDGE_FS_CONTRACT_OPERATIONS) == 176


def test_generated_proxy_operations_preserve_transport_metadata() -> None:
    delete_space = get_knowledge_fs_operation("DELETE", "knowledge-spaces/space-1")
    query = get_knowledge_fs_operation("POST", "queries")
    processing_events = get_knowledge_fs_operation(
        "GET",
        "knowledge-spaces/space-1/documents/document-1/processing-tasks/task-1/events",
    )
    asset = get_knowledge_fs_operation(
        "GET",
        "knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
    )
    parse_artifact = get_knowledge_fs_operation(
        "GET",
        "knowledge-spaces/space-1/documents/document-1/parse-artifacts/1",
    )

    assert delete_space.request_headers == ("idempotency-key",)
    assert query.response_headers == ("x-query-run-id", "x-session-id", "x-trace-id")
    assert query.max_response_bytes == 64 * 1024 * 1024
    assert processing_events.request_headers == ("last-event-id",)
    assert asset.response_headers == (
        "cache-control",
        "content-disposition",
        "content-security-policy",
        "x-content-type-options",
        "x-document-multimodal-asset-variant",
        "x-document-multimodal-item-id",
    )
    assert asset.response_media_types == (
        "application/octet-stream",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    )
    assert parse_artifact.max_response_bytes == 1024 * 1024


@pytest.mark.parametrize(
    ("method", "path", "expected_permission"),
    [
        ("GET", "knowledge-spaces", "dataset_readonly"),
        ("POST", "knowledge-spaces", "dataset_create_and_management"),
        ("DELETE", "knowledge-spaces/space-1", "dataset_edit"),
        ("PATCH", "knowledge-spaces/space-1", "dataset_edit"),
        ("POST", "knowledge-spaces/space-1/documents", "dataset_edit"),
        ("PATCH", "knowledge-spaces/space-1/access-policy", "dataset_access_config"),
        ("POST", "knowledge-spaces/space-1/api-keys", "dataset_api_key_manage"),
        (
            "GET",
            "knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
            "dataset_document_download",
        ),
        ("POST", "knowledge-spaces/space-1/source-connections", "dataset_external_connect"),
    ],
)
def test_generated_proxy_operations_preserve_dify_permissions(
    method: KnowledgeFSMethod,
    path: str,
    expected_permission: str,
) -> None:
    operation = get_knowledge_fs_operation(method, path)

    assert operation.rbac_permission == expected_permission


def test_authorization_rejects_workspace_rbac_denial(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(
        id="account-1",
        has_edit_permission=True,
        is_admin_or_owner=True,
        is_dataset_editor=True,
    )
    check_access = MagicMock(return_value=False)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)
    operation = get_knowledge_fs_operation("GET", "knowledge-spaces")

    with pytest.raises(KnowledgeFSAccessDeniedError):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method="GET",
            operation=operation,
        )

    check_access.assert_called_once_with(
        "tenant-1",
        "account-1",
        scene="dataset_readonly",
        resource_type="dataset",
    )


@pytest.mark.parametrize(
    ("method", "path", "account_attributes"),
    [
        ("POST", "knowledge-spaces", {"is_dataset_editor": False}),
        ("PATCH", "knowledge-spaces/space-1/access-policy", {"is_admin_or_owner": False}),
        ("POST", "knowledge-spaces/space-1/api-keys", {"has_edit_permission": False}),
        ("DELETE", "knowledge-spaces/space-1/api-keys/key-1", {"is_admin_or_owner": False}),
        ("POST", "knowledge-spaces/space-1/source-connections", {"has_edit_permission": False}),
    ],
)
def test_authorization_rejects_insufficient_workspace_role(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    path: str,
    account_attributes: dict[str, bool],
) -> None:
    attributes = {
        "id": "account-1",
        "has_edit_permission": True,
        "is_admin_or_owner": True,
        "is_dataset_editor": True,
        **account_attributes,
    }
    account = MagicMock(**attributes)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method=method,
            operation=get_knowledge_fs_operation(method, path),
        )

    check_access.assert_not_called()


def test_binary_response_uses_the_runtime_asset_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b"binary asset", headers={"Content-Type": "application/octet-stream"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="GET",
        path="knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
        tenant_id="tenant-dev",
    )

    assert result.response.content == response.content
    assert result.response_kind == "binary"
    assert "max_response_bytes" not in request.call_args.kwargs
    assert request.call_args.kwargs["stream_response"] is True


@pytest.mark.parametrize("content_type", ["text/html", "image/svg+xml", "application/pdf"])
def test_binary_response_rejects_uncontracted_media_types(
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b"untrusted asset", headers={"Content-Type": content_type})
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.ssrf_proxy.make_request",
        MagicMock(return_value=response),
    )

    with pytest.raises(KnowledgeFSTransportError, match="unsupported media type"):
        forward_knowledge_fs_request(
            account_id="account-dev",
            method="GET",
            path="knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
            tenant_id="tenant-dev",
        )

    assert response.is_closed


def test_binary_response_larger_than_json_limit_remains_callable(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    payload = b"x" * (2 * 1024 * 1024)
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            content=payload,
            headers={"Content-Type": "application/octet-stream"},
            request=request,
        )
    )

    with httpx.Client(transport=transport) as client:
        monkeypatch.setattr("core.helper.ssrf_proxy._get_ssrf_client", lambda _verify: client)
        result = forward_knowledge_fs_request(
            account_id="account-dev",
            method="GET",
            path="knowledge-spaces/space-1/documents/document-1/multimodal/item-1/asset",
            tenant_id="tenant-dev",
        )

    assert result.response_kind == "binary"
    assert result.response.content == payload


def test_sse_response_sets_a_bounded_body_read_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, sse_read_timeout_seconds=45.0)
    upstream_request = httpx.Request(
        "POST",
        "http://knowledge-fs.test/queries",
        extensions={"timeout": {"read": 7.5}},
    )
    response = httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        request=upstream_request,
    )
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="POST",
        path="queries",
        tenant_id="tenant-dev",
        body=b"{}",
    )

    assert result.response is response
    assert result.response_kind == "stream"
    assert request.call_args.kwargs["timeout"] == 7.5
    assert result.response.request.extensions["timeout"]["read"] == 45.0
    assert request.call_args.kwargs["stream_response"] is True


def test_sse_operation_buffers_json_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(
        400,
        content=b'{"error":"Invalid query request"}',
        headers={"Content-Type": "application/json"},
    )
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="POST",
        path="queries",
        tenant_id="tenant-dev",
        body=b"{}",
    )

    assert result.response_kind == "buffered"
    assert result.response.content == b'{"error":"Invalid query request"}'
    assert result.response.is_closed


def test_parse_artifact_rejects_json_over_the_contract_response_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    payload = b'{"text":"' + b"x" * (2 * 1024 * 1024) + b'"}'
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            content=payload,
            headers={"Content-Type": "application/json"},
            request=request,
        )
    )

    with httpx.Client(transport=transport) as client:
        monkeypatch.setattr("core.helper.ssrf_proxy._get_ssrf_client", lambda _verify: client)
        with pytest.raises(KnowledgeFSTransportError, match="violated the proxy limit"):
            forward_knowledge_fs_request(
                account_id="account-dev",
                method="GET",
                path="knowledge-spaces/space-1/documents/document-1/parse-artifacts/1",
                tenant_id="tenant-dev",
            )


def test_sse_response_rejects_compression_and_closes_the_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(
        200,
        headers={"Content-Encoding": "gzip", "Content-Type": "text/event-stream"},
    )
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTransportError, match="unsupported encoding"):
        forward_knowledge_fs_request(
            account_id="account-dev",
            method="POST",
            path="queries",
            tenant_id="tenant-dev",
            body=b"{}",
        )

    assert response.is_closed


@pytest.mark.parametrize(
    ("method", "path", "expected_scope"),
    [
        ("DELETE", "knowledge-spaces/space-1", "knowledge-spaces:write"),
        ("GET", "knowledge-spaces", "knowledge-spaces:read"),
        ("PATCH", "knowledge-spaces/space-1", "knowledge-spaces:write"),
        ("POST", "queries", "knowledge-spaces:read"),
        ("POST", "research-tasks/plan", "knowledge-spaces:read"),
        ("POST", "agent-workspace-snapshots/snapshot-1/replay", "knowledge-spaces:write"),
        ("POST", "knowledge-spaces", "knowledge-spaces:write"),
        ("PUT", "knowledge-spaces/space-1/retrieval-profile", "knowledge-spaces:write"),
    ],
)
def test_auth_signs_current_account_and_workspace_principal(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    path: str,
    expected_scope: str,
) -> None:
    _set_config(monkeypatch)
    if path == "queries":
        response = httpx.Response(200, headers={"Content-Type": "text/event-stream"})
    else:
        response = httpx.Response(200, content=b'{"items":[]}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        account_id="account-1",
        method=method,
        path=path,
        tenant_id="tenant-1",
    )

    assert result.response.status_code == response.status_code
    authorization = request.call_args.kwargs["headers"]["Authorization"]
    claims = jwt.decode(
        authorization.removeprefix("Bearer "),
        _JWT_SECRET,
        algorithms=["HS256"],
        audience="knowledge-fs",
        issuer="dify",
    )
    assert claims["dify_account_id"] == "dify-account:account-1"
    assert claims["sub"] == "dify-workspace:tenant-1"
    assert claims["tenant_id"] == "tenant-1"
    assert claims["scopes"] == [expected_scope]
    assert claims["caller_kind"] == "interactive"
    assert claims["exp"] - claims["iat"] == 60


@pytest.mark.parametrize(
    "path",
    [
        "queries",
        "research-tasks/plan",
    ],
)
def test_read_post_operations_are_generated_as_read_access(path: str) -> None:
    assert get_knowledge_fs_operation("POST", path).access == "read"


def test_snapshot_replay_is_generated_as_write_access() -> None:
    assert get_knowledge_fs_operation("POST", "agent-workspace-snapshots/snapshot-1/replay").access == "write"


def test_timeout_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ReadTimeout("timed out", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTimeoutError):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


def test_transport_error_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ConnectError("unavailable", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTransportError):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


def test_oversized_response_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    request = MagicMock(side_effect=ssrf_proxy.ResponseTooLargeError("response exceeded 1048576 bytes"))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTransportError, match="response violated the proxy limit"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


def test_ssrf_policy_rejection_is_reported_as_invalid_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    request = MagicMock(side_effect=ToolSSRFError("blocked by SSRF policy"))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="blocked by outbound policy"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "openapi.json"),
        ("GET", "knowledge-spaces/../health"),
        ("GET", "knowledge-spaces/space-1/documents/.."),
        ("PATCH", "knowledge-spaces"),
        ("POST", "knowledge-spaces/fs/write"),
    ],
)
def test_disallowed_route_is_rejected_before_external_io(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    path: str,
) -> None:
    _set_config(monkeypatch)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSRouteNotAllowedError):
        forward_knowledge_fs_request(account_id="account-dev", method=method, path=path, tenant_id="tenant-dev")

    request.assert_not_called()
