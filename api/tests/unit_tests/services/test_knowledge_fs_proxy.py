from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest
from pydantic import SecretStr

from core.tools.errors import ToolSSRFError
from services.knowledge_fs_proxy import (
    KnowledgeFSConfigurationError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    forward_knowledge_fs_request,
)


def _set_config(
    monkeypatch: pytest.MonkeyPatch,
    *,
    base_url: str | None = "http://knowledge-fs.test",
    api_token: str | None = "server-token",
    tenant_id: str | None = "tenant-dev",
    timeout_seconds: float = 7.5,
) -> None:
    values = {
        "KNOWLEDGE_FS_BASE_URL": base_url,
        "KNOWLEDGE_FS_API_TOKEN": SecretStr(api_token) if api_token is not None else None,
        "KNOWLEDGE_FS_STATIC_TENANT_ID": tenant_id,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": timeout_seconds,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_fs_proxy.dify_config.{name}", value, raising=False)


def test_unconfigured_kfs_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url=None, api_token=None, tenant_id=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(method="GET", tenant_id="tenant-dev")

    request.assert_not_called()


def test_partial_configuration_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, api_token=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(method="GET", tenant_id="tenant-dev")

    request.assert_not_called()


def test_get_forwards_raw_query_with_server_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b'{"items":[]}')
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    result = forward_knowledge_fs_request(
        method="GET",
        tenant_id="tenant-dev",
        query=b"limit=20&cursor=first&cursor=second",
    )

    assert result is response
    request.assert_called_once_with(
        "GET",
        "http://knowledge-fs.test/knowledge-spaces",
        max_retries=0,
        params=b"limit=20&cursor=first&cursor=second",
        content=None,
        headers={"Accept": "application/json", "Authorization": "Bearer server-token"},
        timeout=7.5,
        follow_redirects=False,
        ssl_verify=True,
    )


def test_post_forwards_raw_json_without_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(201, content=b'{"id":"space-1"}')
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)
    body = b'{"idempotencyKey":"create-product-docs","name":"Product docs"}'

    result = forward_knowledge_fs_request(method="POST", tenant_id="tenant-dev", body=body)

    assert result is response
    request.assert_called_once_with(
        "POST",
        "http://knowledge-fs.test/knowledge-spaces",
        max_retries=0,
        params=None,
        content=body,
        headers={
            "Accept": "application/json",
            "Authorization": "Bearer server-token",
            "Content-Type": "application/json",
        },
        timeout=7.5,
        follow_redirects=False,
        ssl_verify=True,
    )


def test_static_tenant_mismatch_fails_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="current Dify workspace"):
        forward_knowledge_fs_request(method="GET", tenant_id="another-tenant")

    request.assert_not_called()


def test_timeout_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ReadTimeout("timed out", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTimeoutError):
        forward_knowledge_fs_request(method="GET", tenant_id="tenant-dev")


def test_transport_error_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    upstream_request = httpx.Request("GET", "http://knowledge-fs.test/knowledge-spaces")
    request = MagicMock(side_effect=httpx.ConnectError("unavailable", request=upstream_request))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTransportError):
        forward_knowledge_fs_request(method="GET", tenant_id="tenant-dev")


def test_ssrf_rejection_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    request = MagicMock(side_effect=ToolSSRFError("blocked"))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSTransportError):
        forward_knowledge_fs_request(method="GET", tenant_id="tenant-dev")
