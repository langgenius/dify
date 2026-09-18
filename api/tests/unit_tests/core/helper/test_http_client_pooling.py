from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from core.helper.http_client_pooling import HttpClientPoolFactory


def test_get_or_create_reuses_client_for_same_key() -> None:
    factory = HttpClientPoolFactory()
    first_client = MagicMock(spec=httpx.Client)
    second_client = MagicMock(spec=httpx.Client)
    clients = [first_client, second_client]

    def _builder() -> httpx.Client:
        return clients.pop(0)

    assert factory.get_or_create("shared", _builder) is first_client
    assert factory.get_or_create("shared", _builder) is first_client


def test_get_or_create_creates_distinct_clients_for_distinct_keys() -> None:
    factory = HttpClientPoolFactory()
    client_a = MagicMock(spec=httpx.Client)
    client_b = MagicMock(spec=httpx.Client)

    assert factory.get_or_create("a", lambda: client_a) is client_a
    assert factory.get_or_create("b", lambda: client_b) is client_b


def test_close_all_closes_pooled_clients_and_allows_recreate() -> None:
    factory = HttpClientPoolFactory()
    first_client = MagicMock(spec=httpx.Client)
    replacement_client = MagicMock(spec=httpx.Client)

    assert factory.get_or_create("x", lambda: first_client) is first_client
    factory.close_all()

    first_client.close.assert_called_once()
    assert factory.get_or_create("x", lambda: replacement_client) is replacement_client
