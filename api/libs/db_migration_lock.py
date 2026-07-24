"""
DB migration Redis lock with heartbeat renewal.

This is intentionally migration-specific. Background renewal is a trade-off that makes sense
for unbounded, blocking operations like DB migrations (DDL/DML) where the main thread cannot
periodically refresh the lock TTL.

Do NOT use this as a general-purpose lock primitive for normal application code. Prefer explicit
lock lifecycle management (e.g. redis-py Lock context manager + `extend()` / `reacquire()` from
the same thread) when execution flow is under control.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from redis.exceptions import LockNotOwnedError, RedisError

logger = logging.getLogger(__name__)

MIN_RENEW_INTERVAL_SECONDS = 0.1
DEFAULT_RENEW_INTERVAL_DIVISOR = 3
MIN_JOIN_TIMEOUT_SECONDS = 0.5
MAX_JOIN_TIMEOUT_SECONDS = 5.0
JOIN_TIMEOUT_MULTIPLIER = 2.0


class DbMigrationAutoRenewLock:
    """
    Redis lock wrapper that automatically renews TTL while held (migration-only).

    Notes:
    - We force `thread_local=False` when creating the underlying redis-py lock, because the
      lock token must be accessible from the heartbeat thread for `reacquire()` to work.
    - `release_safely()` is best-effort: it never raises, so it won't mask the caller's
      primary error/exit code.
    """

    _redis_client: Any
    _name: str
    _ttl_seconds: float
    _renew_interval_seconds: float
    _log_context: str | None
    _logger: logging.Logger

    _lock: Any
    _stop_event: threading.Event | None
    _thread: threading.Thread | None
    _acquired: bool

    def __init__(
        self,
        redis_client: Any,
        name: str,
        ttl_seconds: float = 60,
        renew_interval_seconds: float | None = None,
        *,
        logger: logging.Logger | None = None,
        log_context: str | None = None,
    ) -> None:
        self._redis_client = redis_client
        self._name = name
        self._ttl_seconds = float(ttl_seconds)
        self._renew_interval_seconds = (
            float(renew_interval_seconds)
            if renew_interval_seconds is not None
            else max(MIN_RENEW_INTERVAL_SECONDS, self._ttl_seconds / DEFAULT_RENEW_INTERVAL_DIVISOR)
        )
        self._logger = logger or logging.getLogger(__name__)
        self._log_context = log_context

        self._lock = None
        self._stop_event = None
        self._thread = None
        self._acquired = False

    @property
    def name(self) -> str:
        return self._name

    def acquire(self, *args: Any, **kwargs: Any) -> bool:
        """
        Acquire the lock and start heartbeat renewal on success.

        Accepts the same args/kwargs as redis-py `Lock.acquire()`.
        """
        # Prevent accidental double-acquire which could leave the previous heartbeat thread running.
        if self._acquired:
            raise RuntimeError("DB migration lock is already acquired; call release_safely() before acquiring again.")

        # Reuse the lock object if we already created one.
        if self._lock is None:
            self._lock = self._redis_client.lock(
                name=self._name,
                timeout=self._ttl_seconds,
                thread_local=False,
            )
        acquired = bool(self._lock.acquire(*args, **kwargs))
        self._acquired = acquired
        if acquired:
            self._start_heartbeat()
        return acquired

    def owned(self) -> bool:
        if self._lock is None:
            return False
        try:
            return bool(self._lock.owned())
        except Exception:
            # Ownership checks are best-effort and must not break callers.
            return False

    def _start_heartbeat(self) -> None:
        if self._lock is None:
            return
        if self._stop_event is not None:
            return

        self._stop_event = threading.Event()
        self._thread = threading.Thread(
            target=self._heartbeat_loop,
            args=(self._lock, self._stop_event),
            daemon=True,
            name=f"DbMigrationAutoRenewLock({self._name})",
        )
        self._thread.start()

    def _heartbeat_loop(self, lock: Any, stop_event: threading.Event) -> None:
        while not stop_event.wait(self._renew_interval_seconds):
            try:
                lock.reacquire()
            except LockNotOwnedError:
                self._logger.warning(
                    "DB migration lock is no longer owned during heartbeat; stop renewing. log_context=%s",
                    self._log_context,
                    exc_info=True,
                )
                return
            except RedisError:
                self._logger.warning(
                    "Failed to renew DB migration lock due to Redis error; will retry. log_context=%s",
                    self._log_context,
                    exc_info=True,
                )
            except Exception:
                self._logger.warning(
                    "Unexpected error while renewing DB migration lock; will retry. log_context=%s",
                    self._log_context,
                    exc_info=True,
                )

    def release_safely(self, *, status: str | None = None) -> None:
        """
        Stop heartbeat and release lock. Never raises.

        Args:
            status: Optional caller-provided status (e.g. 'successful'/'failed') to add context to logs.
        """
        lock = self._lock
        if lock is None:
            return

        self._stop_heartbeat()

        # Lock release errors should never mask the real error/exit code.
        try:
            lock.release()
        except LockNotOwnedError:
            self._logger.warning(
                "DB migration lock not owned on release; ignoring. status=%s log_context=%s",
                status,
                self._log_context,
                exc_info=True,
            )
        except RedisError:
            self._logger.warning(
                "Failed to release DB migration lock due to Redis error; ignoring. status=%s log_context=%s",
                status,
                self._log_context,
                exc_info=True,
            )
        except Exception:
            self._logger.warning(
                "Unexpected error while releasing DB migration lock; ignoring. status=%s log_context=%s",
                status,
                self._log_context,
                exc_info=True,
            )
        finally:
            self._acquired = False
            self._lock = None

    def _stop_heartbeat(self) -> None:
        if self._stop_event is None:
            return
        self._stop_event.set()
        if self._thread is not None:
            # Best-effort join: if Redis calls are blocked, the daemon thread may remain alive.
            join_timeout_seconds = max(
                MIN_JOIN_TIMEOUT_SECONDS,
                min(MAX_JOIN_TIMEOUT_SECONDS, self._renew_interval_seconds * JOIN_TIMEOUT_MULTIPLIER),
            )
            self._thread.join(timeout=join_timeout_seconds)
            if self._thread.is_alive():
                self._logger.warning(
                    "DB migration lock heartbeat thread did not stop within %.2fs; ignoring. log_context=%s",
                    join_timeout_seconds,
                    self._log_context,
                )
        self._stop_event = None
        self._thread = None
