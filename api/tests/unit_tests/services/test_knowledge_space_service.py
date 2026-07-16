from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr

from clients.knowledge_fs.generated.client import Client as GeneratedKnowledgeFSClient
from services.knowledge_space_service import (
    KnowledgeFSConfigurationError,
    KnowledgeFSTimeoutError,
    KnowledgeFSUpstreamError,
    KnowledgeSpaceService,
    create_knowledge_space_service,
)


def _space_payload(*, tenant_id: str = "tenant-dev") -> dict[str, object]:
    timestamp = datetime(2026, 7, 15, 8, 0, tzinfo=UTC).isoformat()
    return {
        "configurationStatus": "ready",
        "createdAt": timestamp,
        "description": "New RAG knowledge base",
        "id": "space-1",
        "name": "Product docs",
        "revision": 1,
        "slug": "product-docs",
        "tenantId": tenant_id,
        "updatedAt": timestamp,
    }


def _service(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    expected_tenant_id: str = "tenant-dev",
) -> tuple[KnowledgeSpaceService, httpx.Client]:
    http_client = httpx.Client(
        base_url="http://knowledge-fs.test",
        headers={"Authorization": "Bearer server-token"},
        transport=httpx.MockTransport(handler),
    )
    generated_client = GeneratedKnowledgeFSClient(base_url=str(http_client.base_url)).set_httpx_client(http_client)
    return KnowledgeSpaceService(generated_client, expected_tenant_id=expected_tenant_id), http_client


def _set_disabled_config(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "KNOWLEDGE_FS_BASE_URL": None,
        "KNOWLEDGE_FS_API_TOKEN": None,
        "KNOWLEDGE_FS_STATIC_TENANT_ID": None,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": 10.0,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_space_service.dify_config.{name}", value, raising=False)


def test_factory_returns_none_when_kfs_is_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_disabled_config(monkeypatch)

    assert create_knowledge_space_service() is None


def test_factory_rejects_partial_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_disabled_config(monkeypatch)
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788",
    )

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        create_knowledge_space_service()


def test_factory_builds_one_static_authenticated_generated_client(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_disabled_config(monkeypatch)
    captured_keys: list[str] = []
    captured_clients: list[httpx.Client] = []

    def fake_pool(key: str, factory: Callable[[], httpx.Client]) -> httpx.Client:
        captured_keys.append(key)
        client = factory()
        captured_clients.append(client)
        return client

    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_BASE_URL",
        "http://localhost:8788",
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_API_TOKEN",
        SecretStr("server-token"),
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID",
        "tenant-dev",
    )
    monkeypatch.setattr(
        "services.knowledge_space_service.dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS",
        7.5,
    )
    monkeypatch.setattr("services.knowledge_space_service.get_pooled_http_client", fake_pool)

    service = create_knowledge_space_service()

    try:
        assert isinstance(service, KnowledgeSpaceService)
        assert captured_clients[0].base_url == httpx.URL("http://localhost:8788")
        assert captured_clients[0].headers["Authorization"] == "Bearer server-token"
        assert captured_clients[0].timeout.read == 7.5
        assert captured_keys == ["knowledge-fs"]
    finally:
        for client in captured_clients:
            client.close()


def test_list_uses_generated_operation_and_static_server_credential() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer server-token"
        assert request.url.params["limit"] == "20"
        assert request.url.params["cursor"] == "previous-space"
        return httpx.Response(200, json={"items": [_space_payload()], "nextCursor": "product-docs"})

    service, client = _service(handler)
    try:
        result = service.list_knowledge_spaces(
            limit=20,
            cursor="previous-space",
            tenant_id="tenant-dev",
        )
    finally:
        client.close()

    assert result.items[0].id == "space-1"
    assert result.next_cursor == "product-docs"


def test_create_uses_generated_request_and_response_models() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer server-token"
        assert json.loads(request.read()) == {
            "name": "Product docs",
            "description": "New RAG knowledge base",
            "idempotencyKey": "create-product-docs",
        }
        return httpx.Response(201, json=_space_payload())

    service, client = _service(handler)
    try:
        result = service.create_knowledge_space(
            idempotency_key="create-product-docs",
            name="Product docs",
            description="New RAG knowledge base",
            tenant_id="tenant-dev",
        )
    finally:
        client.close()

    assert result.id == "space-1"
    assert result.tenant_id == "tenant-dev"


def test_static_tenant_mismatch_fails_before_external_io() -> None:
    requested = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal requested
        requested = True
        return httpx.Response(200, json={"items": []})

    service, client = _service(handler)
    try:
        with pytest.raises(KnowledgeFSConfigurationError, match="current Dify workspace"):
            service.list_knowledge_spaces(limit=20, cursor=None, tenant_id="another-tenant")
    finally:
        client.close()

    assert requested is False


def test_response_tenant_mismatch_fails_closed() -> None:
    service, client = _service(
        lambda _request: httpx.Response(200, json={"items": [_space_payload(tenant_id="another-tenant")]})
    )
    try:
        with pytest.raises(KnowledgeFSUpstreamError, match="another tenant"):
            service.list_knowledge_spaces(limit=20, cursor=None, tenant_id="tenant-dev")
    finally:
        client.close()


def test_malformed_pagination_cursor_fails_closed() -> None:
    service, client = _service(lambda _request: httpx.Response(200, json={"items": [], "nextCursor": 42}))
    try:
        with pytest.raises(KnowledgeFSUpstreamError, match="pagination cursor"):
            service.list_knowledge_spaces(limit=20, cursor=None, tenant_id="tenant-dev")
    finally:
        client.close()


def test_upstream_status_is_normalized() -> None:
    service, client = _service(lambda _request: httpx.Response(503, json={"error": "unavailable"}))
    try:
        with pytest.raises(KnowledgeFSUpstreamError, match="HTTP 503") as exc_info:
            service.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="tenant-dev",
            )
    finally:
        client.close()

    assert exc_info.value.status_code == 503


def test_timeout_is_normalized() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    service, client = _service(timeout)
    try:
        with pytest.raises(KnowledgeFSTimeoutError):
            service.list_knowledge_spaces(limit=20, cursor=None, tenant_id="tenant-dev")
    finally:
        client.close()
