"""HTTP client pooling utilities."""

from __future__ import annotations

import atexit
import threading
from collections.abc import Callable

import httpx

ClientBuilder = Callable[[], httpx.Client]


class HttpClientPoolFactory:
    """Thread-safe factory that maintains reusable HTTP client instances."""

    def __init__(self) -> None:
        self._clients: dict[str, httpx.Client] = {}
        self._lock = threading.Lock()

    def get_or_create(self, key: str, builder: ClientBuilder) -> httpx.Client:
        """Return a pooled client associated with ``key`` creating it on demand."""
        client = self._clients.get(key)
        if client is not None:
            return client

        with self._lock:
            client = self._clients.get(key)
            if client is None:
                client = builder()
                self._clients[key] = client
        return client

    def close_all(self) -> None:
        """Close all pooled clients and clear the pool."""
        with self._lock:
            for client in self._clients.values():
                client.close()
            self._clients.clear()


_factory = HttpClientPoolFactory()


def get_pooled_http_client(key: str, builder: ClientBuilder) -> httpx.Client:
    """Return a pooled client for the given ``key`` using ``builder`` when missing."""
    return _factory.get_or_create(key, builder)


def close_all_pooled_clients() -> None:
    """Close every client created through the pooling factory."""
    _factory.close_all()


def _register_shutdown_hook() -> None:
    atexit.register(close_all_pooled_clients)


_register_shutdown_hook()
