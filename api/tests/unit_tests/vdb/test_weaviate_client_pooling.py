import threading
import time
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.vdb.weaviate import weaviate_vector as wv
from core.rag.datasource.vdb.weaviate.weaviate_vector import (
    WeaviateConfig,
    WeaviateVector,
    _close_all_weaviate_clients,
    get_weaviate_client,
)


@pytest.fixture(autouse=True)
def _reset_client_pool() -> None:
    # Ensure a clean client pool for each test
    _close_all_weaviate_clients()
    yield
    _close_all_weaviate_clients()


def _make_config(
    endpoint: str = "http://localhost:8080", grpc: str | None = None, api_key: str | None = None
) -> WeaviateConfig:
    return WeaviateConfig(endpoint=endpoint, grpc_endpoint=grpc, api_key=api_key)


def test_get_weaviate_client_creates_new_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    created_client = MagicMock(name="Client1")
    init_calls: list[tuple[WeaviateConfig]] = []

    def fake_init(cfg: WeaviateConfig) -> Any:
        init_calls.append((cfg,))
        return created_client

    monkeypatch.setattr(WeaviateVector, "_init_client", staticmethod(fake_init))

    cfg = _make_config(api_key="key1")
    client = get_weaviate_client(cfg)

    assert client is created_client
    assert len(init_calls) == 1
    assert init_calls[0][0] == cfg


def test_get_weaviate_client_returns_pooled_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    created_client = MagicMock(name="Client1")
    init_call_count = 0

    def fake_init(cfg: WeaviateConfig) -> Any:
        nonlocal init_call_count
        init_call_count += 1
        return created_client

    monkeypatch.setattr(WeaviateVector, "_init_client", staticmethod(fake_init))

    cfg = _make_config(api_key="key1")
    c1 = get_weaviate_client(cfg)
    c2 = get_weaviate_client(cfg)

    assert c1 is c2 is created_client
    assert init_call_count == 1  # created once, reused thereafter


def test_get_weaviate_client_thread_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    created_client = MagicMock(name="ClientThreaded")
    init_call_count = 0

    def fake_init(cfg: WeaviateConfig) -> Any:
        nonlocal init_call_count
        # Add a tiny delay to increase likelihood of race without lock
        time.sleep(0.05)
        init_call_count += 1
        return created_client

    monkeypatch.setattr(WeaviateVector, "_init_client", staticmethod(fake_init))

    cfg = _make_config(api_key="key1")

    results: list[Any] = []
    exceptions: list[BaseException] = []

    def worker():
        try:
            results.append(get_weaviate_client(cfg))
        except BaseException as e:  # pragma: no cover - just in case
            exceptions.append(e)

    threads: list[threading.Thread] = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not exceptions
    assert len(results) == 10
    # All returned the same instance
    assert all(r is created_client for r in results)
    # Only initialized once despite concurrency
    assert init_call_count == 1


def test_close_all_weaviate_clients_closes_and_clears(monkeypatch: pytest.MonkeyPatch) -> None:
    # Prepare two different configs to populate the pool with distinct clients
    client_a = MagicMock(name="ClientA")
    client_b = MagicMock(name="ClientB")
    init_map: dict[str, Any] = {
        "http://localhost:8080||keyA": client_a,
        "http://localhost:8081||keyB": client_b,
    }

    def fake_init(cfg: WeaviateConfig) -> Any:
        key = f"{cfg.endpoint}|{cfg.grpc_endpoint or ''}|{cfg.api_key or ''}"
        return init_map[key]

    monkeypatch.setattr(WeaviateVector, "_init_client", staticmethod(fake_init))

    cfg_a = _make_config(endpoint="http://localhost:8080", api_key="keyA")
    cfg_b = _make_config(endpoint="http://localhost:8081", api_key="keyB")

    # Populate pool
    ca = get_weaviate_client(cfg_a)
    cb = get_weaviate_client(cfg_b)

    assert ca is client_a
    assert cb is client_b

    # Close all
    _close_all_weaviate_clients()

    client_a.close.assert_called_once()
    client_b.close.assert_called_once()

    # Pool should be empty - a new request should trigger init again
    # Replace init to observe a second call
    new_client = MagicMock(name="ClientNew")

    def fake_init_new(cfg: WeaviateConfig) -> Any:
        return new_client

    monkeypatch.setattr(WeaviateVector, "_init_client", staticmethod(fake_init_new))

    c_after = get_weaviate_client(cfg_a)
    assert c_after is new_client


def test_weaviatevector_uses_shared_client(monkeypatch: pytest.MonkeyPatch) -> None:
    shared_client = MagicMock(name="SharedClient")
    calls: list[WeaviateConfig] = []

    def fake_get(cfg: WeaviateConfig) -> Any:
        calls.append(cfg)
        return shared_client

    # Patch the module-level function used by WeaviateVector.__init__
    monkeypatch.setattr(wv, "get_weaviate_client", fake_get)

    cfg = _make_config(api_key="key1")

    v1 = WeaviateVector(collection_name="c1", config=cfg, attributes=["doc_id"])  # type: ignore[arg-type]
    v2 = WeaviateVector(collection_name="c2", config=cfg, attributes=["doc_id"])  # type: ignore[arg-type]

    assert v1._client is shared_client
    assert v2._client is shared_client
    assert len(calls) == 2
    assert all(c is cfg for c in calls)
