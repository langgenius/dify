from __future__ import annotations

from collections.abc import Callable

import httpx

from clients.knowledge_fs import OpenAPIKnowledgeFSClient
from clients.knowledge_fs.credentials import StaticKnowledgeFSCredentialProvider
from clients.knowledge_fs.factory import create_knowledge_fs_client


def test_factory_pools_across_providers_without_storing_credentials_in_headers_or_pool_key(monkeypatch) -> None:
    captured_clients: list[httpx.Client] = []
    captured_keys: list[str] = []

    def fake_pool(key: str, factory: Callable[[], httpx.Client]) -> httpx.Client:
        captured_keys.append(key)
        client = factory()
        captured_clients.append(client)
        return client

    monkeypatch.setattr("clients.knowledge_fs.factory.get_pooled_http_client", fake_pool)

    first = create_knowledge_fs_client(
        base_url="https://knowledge-fs.test/",
        credential_provider=StaticKnowledgeFSCredentialProvider(token="first-secret-token"),
        timeout_seconds=7.5,
    )
    create_knowledge_fs_client(
        base_url="https://knowledge-fs.test/",
        credential_provider=StaticKnowledgeFSCredentialProvider(token="second-secret-token"),
        timeout_seconds=7.5,
    )

    try:
        assert isinstance(first, OpenAPIKnowledgeFSClient)
        assert captured_clients[0].base_url == httpx.URL("https://knowledge-fs.test")
        assert captured_clients[0].headers["Accept"] == "application/json"
        assert captured_clients[0].headers["Accept-Encoding"] == "identity"
        assert all("Authorization" not in client.headers for client in captured_clients)
        assert captured_clients[0].timeout.read == 7.5
        assert captured_keys[0] == captured_keys[1]
        assert all("secret-token" not in key for key in captured_keys)
    finally:
        for client in captured_clients:
            client.close()
