"""Redis leases for OAuth refreshes that can outlive a fixed lock timeout."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from threading import Event, Thread
from typing import Literal

from redis.exceptions import LockError, RedisError
from redis.lock import Lock

from extensions.ext_redis import RedisClientWrapper
from services.credentials.refresh import CredentialRefreshLease, CredentialRefreshUnavailableError

logger = logging.getLogger(__name__)

_LEASE_SECONDS = 60
_WAIT_SECONDS = 30
_RENEW_SECONDS = 20


class _RefreshLease:
    def __init__(self, lock: Lock, lost: Event) -> None:
        self._lock = lock
        self._lost = lost

    def ensure_owned(self) -> None:
        if self._lost.is_set():
            raise CredentialRefreshUnavailableError()
        try:
            self._lock.reacquire()
        except (LockError, RedisError) as exc:
            self._lost.set()
            raise CredentialRefreshUnavailableError() from exc


class RedisCredentialRefreshLock:
    def __init__(self, *, client: RedisClientWrapper) -> None:
        self._client = client

    @contextmanager
    def acquire(
        self, *, credential_type: Literal["tool", "datasource"], workspace_id: str, credential_id: str
    ) -> Generator[CredentialRefreshLease]:
        name = f"oauth:credential-refresh:{credential_type}:{workspace_id}:{credential_id}"
        lock = self._client.lock(name, timeout=_LEASE_SECONDS, blocking_timeout=_WAIT_SECONDS, thread_local=False)
        try:
            if not lock.acquire():
                raise CredentialRefreshUnavailableError()
        except (LockError, RedisError) as exc:
            raise CredentialRefreshUnavailableError() from exc

        stopped, lost = Event(), Event()
        lease = _RefreshLease(lock, lost)

        def renew() -> None:
            while not stopped.wait(_RENEW_SECONDS):
                try:
                    lease.ensure_owned()
                except Exception:
                    lost.set()
                    logger.warning("Lost credential refresh lease: %s", name, exc_info=True)
                    return

        heartbeat = Thread(target=renew, daemon=True, name=f"CredentialRefresh({credential_id})")
        try:
            heartbeat.start()
            yield lease
        finally:
            stopped.set()
            if heartbeat.ident is not None:
                heartbeat.join(timeout=2)
            try:
                lock.release()
            except (LockError, RedisError):
                logger.warning("Failed to release credential refresh lease: %s", name, exc_info=True)
