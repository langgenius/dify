"""Serialize monthly archive storage work while renewing the lease during blocking S3 operations."""

import logging
import threading
from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from typing import Protocol

from redis.lock import Lock

from extensions.ext_redis import RedisClientWrapper

logger = logging.getLogger(__name__)

_LOCK_TTL_SECONDS = 120
_RENEW_INTERVAL_SECONDS = 30


class WorkflowRunArchiveMonthBusyError(RuntimeError):
    """Another upload or deletion still owns the monthly storage lease."""


class WorkflowRunArchiveMonthLease(Protocol):
    def assert_owned(self) -> None: ...


class WorkflowRunArchiveMonthLock(Protocol):
    def __call__(
        self, *, tenant_id: str, year: int, month: int
    ) -> AbstractContextManager[WorkflowRunArchiveMonthLease]: ...


class _MonthLease:
    def __init__(self, lock: Lock, lost: threading.Event) -> None:
        self._lock = lock
        self._lost = lost

    def assert_owned(self) -> None:
        if self._lost.is_set() or not self._lock.owned():
            raise RuntimeError("Workflow run archive month lock was lost")


class RedisWorkflowRunArchiveMonthLock:
    """A shared month lease prevents ZIP uploads from racing permanent deletion or surviving worker crashes."""

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @contextmanager
    def __call__(self, *, tenant_id: str, year: int, month: int) -> Generator[WorkflowRunArchiveMonthLease]:
        name = f"workflow_run_archive_month:{tenant_id}:{year:04d}-{month:02d}"
        lock = self._redis.lock(name, timeout=_LOCK_TTL_SECONDS, blocking_timeout=_LOCK_TTL_SECONDS, thread_local=False)
        if not lock.acquire():
            raise WorkflowRunArchiveMonthBusyError("Workflow run archive month is busy; please retry")
        stopped, lost = threading.Event(), threading.Event()

        def renew() -> None:
            while not stopped.wait(_RENEW_INTERVAL_SECONDS):
                try:
                    lock.reacquire()
                except Exception:
                    lost.set()
                    logger.exception("Lost workflow run archive month lease: %s", name)
                    return

        heartbeat = threading.Thread(target=renew, daemon=True, name=f"ArchiveMonthLease({name})")
        heartbeat.start()
        try:
            yield _MonthLease(lock, lost)
        finally:
            stopped.set()
            heartbeat.join(timeout=5)
            try:
                lock.release()
            except Exception:
                logger.warning("Failed to release workflow run archive month lease: %s", name, exc_info=True)
