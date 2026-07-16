from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import jwt
import pytest
from pydantic import SecretStr

from services.knowledge_fs_proxy import (
    KnowledgeFSConfigurationError,
    KnowledgeFSMethod,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    forward_knowledge_fs_request,
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


def test_unconfigured_kfs_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url=None, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(method="GET", path="knowledge-spaces", tenant_id="tenant-dev")

    request.assert_not_called()


def test_partial_configuration_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(method="GET", path="knowledge-spaces", tenant_id="tenant-dev")

    request.assert_not_called()


def test_get_forwards_raw_query(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url="http://knowledge-fs.test/gateway")
    response = httpx.Response(200, content=b'{"items":[]}')
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    result = forward_knowledge_fs_request(
        method="GET",
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        query=b"limit=20&cursor=first&cursor=second",
    )

    assert result is response
    request.assert_called_once()
    assert request.call_args.args == ("GET", httpx.URL("http://knowledge-fs.test/gateway/knowledge-spaces"))
    assert request.call_args.kwargs["params"] == b"limit=20&cursor=first&cursor=second"
    assert request.call_args.kwargs["content"] is None
    assert request.call_args.kwargs["headers"]["Accept"] == "application/json"
    assert request.call_args.kwargs["headers"]["Authorization"].startswith("Bearer ")
    assert request.call_args.kwargs["timeout"] == 7.5
    assert request.call_args.kwargs["follow_redirects"] is False


def test_post_forwards_raw_json_without_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(201, content=b'{"id":"space-1"}')
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    result = forward_knowledge_fs_request(
        method="POST",
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        body=body,
    )

    assert result is response
    request.assert_called_once()
    assert request.call_args.args == ("POST", httpx.URL("http://knowledge-fs.test/knowledge-spaces"))
    assert request.call_args.kwargs["params"] is None
    assert request.call_args.kwargs["content"] == body
    assert request.call_args.kwargs["headers"]["Accept"] == "application/json"
    assert request.call_args.kwargs["headers"]["Authorization"].startswith("Bearer ")
    assert request.call_args.kwargs["headers"]["Content-Type"] == "application/json"
    assert request.call_args.kwargs["timeout"] == 7.5
    assert request.call_args.kwargs["follow_redirects"] is False


@pytest.mark.parametrize(
    ("method", "expected_scope"),
    [("GET", "knowledge-spaces:read"), ("POST", "knowledge-spaces:write")],
)
def test_auth_signs_current_workspace_principal(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    expected_scope: str,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b'{"items":[]}')
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    result = forward_knowledge_fs_request(
        method=method,
        path="knowledge-spaces",
        tenant_id="tenant-1",
    )

    assert result is response
    authorization = request.call_args.kwargs["headers"]["Authorization"]
    claims = jwt.decode(
        authorization.removeprefix("Bearer "),
        _JWT_SECRET,
        algorithms=["HS256"],
        audience="knowledge-fs",
        issuer="dify",
    )
    assert claims["sub"] == "dify-workspace:tenant-1"
    assert claims["tenant_id"] == "tenant-1"
    assert claims["scopes"] == [expected_scope]
    assert claims["caller_kind"] == "interactive"
    assert claims["exp"] - claims["iat"] == 60


def test_timeout_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ReadTimeout("timed out", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    with pytest.raises(KnowledgeFSTimeoutError):
        forward_knowledge_fs_request(method="GET", path="knowledge-spaces", tenant_id="tenant-dev")


def test_transport_error_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ConnectError("unavailable", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    with pytest.raises(KnowledgeFSTransportError):
        forward_knowledge_fs_request(method="GET", path="knowledge-spaces", tenant_id="tenant-dev")


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "openapi.json"),
        ("GET", "knowledge-spaces/../health"),
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
    monkeypatch.setattr("services.knowledge_fs_proxy._HTTP_CLIENT.request", request)

    with pytest.raises(KnowledgeFSRouteNotAllowedError):
        forward_knowledge_fs_request(method=method, path=path, tenant_id="tenant-dev")

    request.assert_not_called()
