from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import jwt
import pytest
from pydantic import SecretStr

from core.helper import ssrf_proxy
from core.rbac import RBACPermission
from core.tools.errors import ToolSSRFError
from services.knowledge_fs_proxy import (
    KNOWLEDGE_FS_CONSOLE_OPERATIONS,
    KnowledgeFSAccessDeniedError,
    KnowledgeFSConfigurationError,
    KnowledgeFSMethod,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    authorize_knowledge_fs_request,
    get_knowledge_fs_operation,
    proxy_knowledge_fs_request,
)
from services.knowledge_fs_proxy import (
    _forward_knowledge_fs_request as forward_knowledge_fs_request,
)

_JWT_SECRET = "production-secret-with-at-least-32-bytes"


def _set_config(
    monkeypatch: pytest.MonkeyPatch,
    *,
    base_url: str | None = "http://knowledge-fs.test",
    timeout_seconds: float = 7.5,
    jwt_secret: str | None = _JWT_SECRET,
) -> None:
    values = {
        "KNOWLEDGE_FS_BASE_URL": base_url,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": timeout_seconds,
        "KNOWLEDGE_FS_JWT_SECRET": SecretStr(jwt_secret) if jwt_secret is not None else None,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_fs_proxy.dify_config.{name}", value, raising=False)


def test_console_registry_starts_with_list_and_create_operations() -> None:
    assert tuple(operation.operation_id for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS) == (
        "listKnowledgeSpaces",
        "createKnowledgeSpace",
    )


@pytest.mark.parametrize(
    ("method", "operation_id", "scope", "permission", "requires_dataset_editor"),
    [
        ("GET", "listKnowledgeSpaces", "knowledge-spaces:read", RBACPermission.DATASET_READONLY, False),
        (
            "POST",
            "createKnowledgeSpace",
            "knowledge-spaces:write",
            RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
            True,
        ),
    ],
)
def test_console_registry_preserves_contract_and_policy(
    method: KnowledgeFSMethod,
    operation_id: str,
    scope: str,
    permission: RBACPermission,
    requires_dataset_editor: bool,
) -> None:
    operation = get_knowledge_fs_operation(method, "knowledge-spaces")

    assert operation.operation_id == operation_id
    assert operation.required_scope == scope
    assert operation.rbac_permission == permission
    assert operation.requires_dataset_editor is requires_dataset_editor
    assert operation.max_response_bytes == 1_048_576
    assert operation.request_headers == ("x-trace-id",)
    assert operation.response_headers == ("x-trace-id",)
    assert operation.response_media_types == ("application/json",)


def test_unconfigured_kfs_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url=None, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    request.assert_not_called()


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_list_and_create_forward_raw_request(monkeypatch: pytest.MonkeyPatch, method: KnowledgeFSMethod) -> None:
    _set_config(monkeypatch, base_url="http://knowledge-fs.test/gateway")
    response = httpx.Response(201, content=b'{"id":"space-1"}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)
    body = b'{"name":"Product docs"}' if method == "POST" else None
    query = b"limit=20&cursor=first" if method == "GET" else None

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method=method,
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        query=query,
        body=body,
    )

    assert result.response.content == response.content
    assert result.response_kind == "buffered"
    assert request.call_args.kwargs["method"] == method
    assert request.call_args.kwargs["url"] == "http://knowledge-fs.test/gateway/knowledge-spaces"
    assert request.call_args.kwargs["params"] == query
    assert request.call_args.kwargs["content"] == body
    assert request.call_args.kwargs["follow_redirects"] is False
    assert request.call_args.kwargs["max_retries"] == 0
    assert request.call_args.kwargs["stream_response"] is True


def test_proxy_forwards_only_registry_declared_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    upstream = MagicMock()
    forward = MagicMock(return_value=upstream)
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.RBACService.CheckAccess.check",
        MagicMock(return_value=True),
    )
    monkeypatch.setattr("services.knowledge_fs_proxy._forward_knowledge_fs_request", forward)

    result = proxy_knowledge_fs_request(
        account=account,
        method="POST",
        path="knowledge-spaces",
        tenant_id="tenant-1",
        request_headers={"Authorization": "browser-secret", "X-Trace-Id": "trace-1"},
    )

    assert result is upstream
    assert forward.call_args.kwargs["request_headers"] == {"x-trace-id": "trace-1"}


def test_authorization_rejects_workspace_rbac_denial(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    check_access = MagicMock(return_value=False)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            operation=get_knowledge_fs_operation("GET", "knowledge-spaces"),
        )

    check_access.assert_called_once_with(
        "tenant-1",
        "account-1",
        scene="dataset_readonly",
        resource_type="dataset",
    )


def test_create_rejects_non_dataset_editor_before_rbac(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError, match="dataset edit access"):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            operation=get_knowledge_fs_operation("POST", "knowledge-spaces"),
        )

    check_access.assert_not_called()


def test_authorization_uses_the_declared_editor_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)
    operation = get_knowledge_fs_operation("POST", "knowledge-spaces")._replace(requires_dataset_editor=False)

    authorize_knowledge_fs_request(account=account, tenant_id="tenant-1", operation=operation)

    check_access.assert_called_once()


@pytest.mark.parametrize(
    ("method", "expected_scope"),
    [("GET", "knowledge-spaces:read"), ("POST", "knowledge-spaces:write")],
)
def test_auth_signs_current_principals_and_declared_scope(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    expected_scope: str,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b'{"items":[]}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    forward_knowledge_fs_request(
        account_id="account-1",
        method=method,
        path="knowledge-spaces",
        tenant_id="tenant-1",
    )

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


def test_buffered_response_rejects_non_empty_body_without_content_type(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b"<html>unexpected</html>")
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(return_value=response))

    with pytest.raises(KnowledgeFSTransportError, match="unsupported media type"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    assert response.is_closed


@pytest.mark.parametrize(
    ("error", "expected_exception"),
    [
        (
            httpx.ReadTimeout("timed out", request=httpx.Request("GET", "http://knowledge-fs.test")),
            KnowledgeFSTimeoutError,
        ),
        (
            httpx.ConnectError("unavailable", request=httpx.Request("GET", "http://knowledge-fs.test")),
            KnowledgeFSTransportError,
        ),
        (ssrf_proxy.ResponseTooLargeError("too large"), KnowledgeFSTransportError),
        (ToolSSRFError("blocked"), KnowledgeFSConfigurationError),
    ],
)
def test_transport_failures_are_normalized(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_exception: type[Exception],
) -> None:
    _set_config(monkeypatch)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(side_effect=error))

    with pytest.raises(expected_exception):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "openapi.json"),
        ("GET", "knowledge-spaces/space-1"),
        ("PATCH", "knowledge-spaces"),
        ("POST", "queries"),
        ("POST", "knowledge-spaces/space-1/documents"),
    ],
)
def test_unregistered_route_is_rejected_before_external_io(
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
