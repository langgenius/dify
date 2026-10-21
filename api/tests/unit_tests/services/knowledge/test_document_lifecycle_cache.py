from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import cast

import pytest

from extensions.ext_redis import RedisClientWrapper
from services.knowledge.documents import adapters as document_adapters
from services.knowledge.documents.adapters import RedisDocumentLifecycleCache
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError


@dataclass(frozen=True)
class MarkerLease:
    token: str


class RecordingMarkerLocks:
    def __init__(self) -> None:
        self.current_token: str | None = None
        self.names: list[str] = []

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[MarkerLease]:
        assert timeout == 1
        assert blocking_timeout == 0
        self.names.append(name)
        if self.current_token is not None and self.current_token != expected_token:
            raise KnowledgeIndexingLockBusyError(name)
        self.current_token = "worker-marker"
        try:
            yield MarkerLease("worker-marker")
        finally:
            self.current_token = None


class RecordingRedis:
    def __init__(self, locks: RecordingMarkerLocks) -> None:
        self._locks = locks
        self.set_calls: list[tuple[str, str, bool, int]] = []

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> bool:
        self.set_calls.append((name, value, nx, ex))
        if self._locks.current_token is not None:
            return False
        self._locks.current_token = value
        return True


def _cache(monkeypatch: pytest.MonkeyPatch, locks: RecordingMarkerLocks) -> RedisDocumentLifecycleCache:
    monkeypatch.setattr(document_adapters, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)
    return RedisDocumentLifecycleCache(redis=cast(RedisClientWrapper, RecordingRedis(locks)))


def test_sync_marker_stores_the_generation_as_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    locks = RecordingMarkerLocks()
    cache = _cache(monkeypatch, locks)

    assert cache.try_mark_syncing("document-1", token="generation-1")
    assert not cache.try_mark_syncing("document-1", token="generation-2")
    assert locks.current_token == "generation-1"


def test_sync_marker_release_preserves_a_new_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    locks = RecordingMarkerLocks()
    cache = _cache(monkeypatch, locks)
    locks.current_token = "new-owner"

    cache.clear_syncing("document-1", token="old-owner")

    assert locks.current_token == "new-owner"


def test_sync_marker_release_removes_its_own_token(monkeypatch: pytest.MonkeyPatch) -> None:
    locks = RecordingMarkerLocks()
    cache = _cache(monkeypatch, locks)
    locks.current_token = "owner-1"

    cache.clear_syncing("document-1", token="owner-1")

    assert not locks.current_token
