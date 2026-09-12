"""The per-dataset merge lease that keeps concurrent graph writes apart."""

from collections.abc import Callable

import pytest

from configs import dify_config
from core.rag.datasource.graph import graph_lock as graph_lock_module
from core.rag.datasource.graph.graph_lock import GraphIndexLockError, graph_index_lock


class _FakeLock:
    def __init__(self, *, acquired: bool = True, extend_error: Exception | None = None) -> None:
        self._acquired = acquired
        self._extend_error = extend_error
        self.released = False
        self.extensions: list[tuple[float, bool]] = []

    def acquire(self) -> bool:
        return self._acquired

    def extend(self, additional_time: float, replace_ttl: bool = False) -> None:
        self.extensions.append((additional_time, replace_ttl))
        if self._extend_error:
            raise self._extend_error

    def release(self) -> None:
        self.released = True


class _FakeRedis:
    def __init__(self, lock: _FakeLock) -> None:
        self._lock = lock
        self.name: str | None = None
        self.timeout: float | None = None
        self.blocking_timeout: float | None = None

    def lock(self, name: str, timeout: float | None = None, blocking_timeout: float | None = None) -> _FakeLock:
        self.name = name
        self.timeout = timeout
        self.blocking_timeout = blocking_timeout
        return self._lock


@pytest.fixture
def install_lock(monkeypatch: pytest.MonkeyPatch) -> Callable[[_FakeLock], _FakeRedis]:
    def _install(lock: _FakeLock) -> _FakeRedis:
        redis = _FakeRedis(lock)
        monkeypatch.setattr(graph_lock_module, "redis_client", redis)
        return redis

    return _install


def test_the_lease_is_taken_per_dataset_and_released_afterwards(
    install_lock: Callable[[_FakeLock], _FakeRedis],
) -> None:
    lock = _FakeLock()
    redis = install_lock(lock)

    with graph_index_lock("dataset-1"):
        pass

    # Two knowledge bases index in parallel; only writers of the same one queue.
    assert redis.name == "graph_indexing_lock_dataset-1"
    assert redis.timeout == dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT
    assert redis.blocking_timeout == dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_WAIT
    assert lock.released


def test_the_lease_is_released_when_the_merge_raises(install_lock: Callable[[_FakeLock], _FakeRedis]) -> None:
    lock = _FakeLock()
    install_lock(lock)

    with pytest.raises(RuntimeError), graph_index_lock("dataset-1"):
        raise RuntimeError("merge blew up")

    # A held lease would block every later indexing run for this dataset until
    # it expired on its own.
    assert lock.released


def test_waiting_out_the_lease_fails_fast(install_lock: Callable[[_FakeLock], _FakeRedis]) -> None:
    install_lock(_FakeLock(acquired=False))

    with pytest.raises(GraphIndexLockError, match="still indexing"):
        with graph_index_lock("dataset-1"):
            pytest.fail("the merge must not run without the lease")


def test_losing_the_lease_mid_merge_aborts_it(install_lock: Callable[[_FakeLock], _FakeRedis]) -> None:
    install_lock(_FakeLock(extend_error=RuntimeError("lock no longer owned")))

    # Renewal only fails when the lease expired and somebody else took it, which
    # means a second writer is already inside the merge this one is halfway
    # through. Carrying on would interleave the two.
    with pytest.raises(GraphIndexLockError, match="mid-write"):
        with graph_index_lock("dataset-1") as renew:
            renew()


def test_renewal_replaces_the_ttl_rather_than_stacking_it(
    install_lock: Callable[[_FakeLock], _FakeRedis],
) -> None:
    lock = _FakeLock()
    install_lock(lock)

    with graph_index_lock("dataset-1") as renew:
        renew()
        renew()

    assert lock.extensions == [
        (dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT, True),
        (dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT, True),
    ]
