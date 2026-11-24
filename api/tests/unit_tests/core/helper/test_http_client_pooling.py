from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from core.helper.http_client_pooling import HttpClientPoolFactory
from tests.helpers.unit.core.helper.tls_proxy import tls_proxy


@pytest.fixture
def http_clients() -> Iterator[tuple[httpx.Client, httpx.Client]]:
    def reject_request(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Pooling must not send requests: {request.url}")

    with (
        httpx.Client(transport=httpx.MockTransport(reject_request)) as first,
        httpx.Client(transport=httpx.MockTransport(reject_request)) as second,
    ):
        yield first, second


def test_get_or_create_reuses_client_for_same_key(http_clients: tuple[httpx.Client, httpx.Client]) -> None:
    factory = HttpClientPoolFactory()
    first_client, second_client = http_clients
    clients = [first_client, second_client]

    def _builder() -> httpx.Client:
        return clients.pop(0)

    assert factory.get_or_create("shared", _builder) is first_client
    assert factory.get_or_create("shared", _builder) is first_client


def test_get_or_create_creates_distinct_clients_for_distinct_keys(
    http_clients: tuple[httpx.Client, httpx.Client],
) -> None:
    factory = HttpClientPoolFactory()
    client_a, client_b = http_clients

    assert factory.get_or_create("a", lambda: client_a) is client_a
    assert factory.get_or_create("b", lambda: client_b) is client_b


def test_close_all_closes_pooled_clients_and_allows_recreate(http_clients: tuple[httpx.Client, httpx.Client]) -> None:
    factory = HttpClientPoolFactory()
    first_client, replacement_client = http_clients

    assert factory.get_or_create("x", lambda: first_client) is first_client
    assert not first_client.is_closed
    factory.close_all()

    assert first_client.is_closed
    assert not replacement_client.is_closed
    assert factory.get_or_create("x", lambda: replacement_client) is replacement_client


@pytest.mark.parametrize(
    ("host", "error"),
    [("wrong.example", httpx.ConnectError), ("timeout.example", httpx.ConnectTimeout)],
)
def test_pooled_client_recovers_after_proxy_tls_failure(
    tmp_path: Path, host: str, error: type[httpx.TransportError]
) -> None:
    """With one connection slot, a failed handshake must allow the next request."""
    factory = HttpClientPoolFactory()
    with tls_proxy(tmp_path) as (proxy_url, context, release):
        client = factory.get_or_create(
            "proxy",
            lambda: httpx.Client(
                proxy=proxy_url,
                verify=context,
                limits=httpx.Limits(max_connections=1),
                timeout=httpx.Timeout(2, connect=0.2, pool=0.2),
                trust_env=False,
            ),
        )
        try:
            with pytest.raises(error):
                client.get(f"https://{host}/")
            release.set()
            assert client.get("https://localhost/").text == "OK"
        finally:
            factory.close_all()


@pytest.mark.parametrize(
    ("host", "error"),
    [("wrong.example", httpx.ConnectError), ("timeout.example", httpx.ConnectTimeout)],
)
@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_async_client_recovers_after_proxy_tls_failure(
    tmp_path: Path, host: str, error: type[httpx.TransportError]
) -> None:
    """The same dependency pin must release failed asynchronous proxy tunnels."""
    with tls_proxy(tmp_path) as (proxy_url, context, release):
        async with httpx.AsyncClient(
            proxy=proxy_url,
            verify=context,
            limits=httpx.Limits(max_connections=1),
            timeout=httpx.Timeout(2, connect=0.2, pool=0.2),
            trust_env=False,
        ) as client:
            with pytest.raises(error):
                await client.get(f"https://{host}/")
            release.set()
            assert (await client.get("https://localhost/")).text == "OK"
