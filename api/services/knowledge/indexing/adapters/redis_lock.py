"""Redis lease adapter with token-safe handoff, renewal, and release."""

import logging
import threading
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Protocol
from uuid import uuid4

from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
)

logger = logging.getLogger(__name__)

# redis-py Lock covers acquisition, renewal, ownership checks, and token-safe
# release. This script is deliberately limited to the one operation its public
# API cannot express: atomically handing a producer-owned lease to a worker.
_ADOPT_SCRIPT = """
local current = redis.call('get', KEYS[1])
if (not current) or current == ARGV[1] then
    redis.call('psetex', KEYS[1], ARGV[3], ARGV[2])
    return 1
end
return 0
"""

# Producer admission and worker ownership share one Redis key without exposing
# its token through the Celery message. The durable actor marker survives a
# worker TTL so only that actor can recover. A missing key and missing marker is
# reserved for draining pre-marker messages after their raw lock expires; an
# active raw or worker value can never be rotated by another delivery.
_HANDOFF_SCRIPT = """
local current = redis.call('get', KEYS[1])
local owner = redis.call('get', KEYS[2])
local producer_prefix = 'producer:' .. ARGV[1] .. ':'
if ((not current) and ((not owner) or owner == ARGV[1])) or
   (current and string.sub(current, 1, string.len(producer_prefix)) == producer_prefix) then
    redis.call('psetex', KEYS[1], ARGV[3], ARGV[2])
    redis.call('set', KEYS[2], ARGV[1])
    return 1
end
return 0
"""

_ACQUIRE_HANDOFF_SCRIPT = """
if not redis.call('get', KEYS[1]) then
    redis.call('psetex', KEYS[1], ARGV[3], ARGV[2])
    redis.call('set', KEYS[2], ARGV[1])
    return 1
end
return 0
"""

_MARK_HANDOFF_OWNER_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    redis.call('set', KEYS[2], ARGV[2])
    return 1
end
return 0
"""

_CLEAR_HANDOFF_OWNER_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] and redis.call('get', KEYS[2]) == ARGV[2] then
    redis.call('del', KEYS[1], KEYS[2])
    return 1
end
return 0
"""


class _TokenEncoder(Protocol):
    def encode(self, value: str) -> bytes: ...


class _LockRedisBackend(Protocol):
    def get_encoder(self) -> _TokenEncoder: ...


class _LockLocalState(Protocol):
    token: bytes | None


class RedisLockHandle(Protocol):
    @property
    def redis(self) -> _LockRedisBackend: ...

    @property
    def local(self) -> _LockLocalState: ...

    def acquire(self, *, blocking: bool, token: str) -> bool: ...

    def reacquire(self) -> bool: ...

    def release(self) -> None: ...


class RedisScript(Protocol):
    def __call__(self, *, keys: list[str], args: list[object]) -> object: ...


class RedisLockClient(Protocol):
    def lock(
        self,
        name: str,
        timeout: float | None = None,
        sleep: float = 0.1,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        thread_local: bool = True,
    ) -> RedisLockHandle: ...

    def register_script(self, script: str) -> RedisScript: ...


class _RedisKnowledgeIndexingLease(KnowledgeIndexingLease):
    def __init__(
        self,
        *,
        lock: RedisLockHandle,
        name: str,
        token: str,
        renew_owner: Callable[[], bool] | None = None,
        release_handoff: Callable[[], bool] | None = None,
    ) -> None:
        self._lock = lock
        self._name = name
        self._token = token
        self._renew_owner = renew_owner
        self._release_handoff = release_handoff
        self._lost = threading.Event()

    @property
    def token(self) -> str:
        return self._token

    def assert_owned(self) -> None:
        if self._lost.is_set() or not self.renew():
            self._lost.set()
            raise KnowledgeIndexingLeaseLostError(f"Knowledge indexing lease was lost: {self._name}")

    def renew(self) -> bool:
        if self._lost.is_set():
            return False
        try:
            owned = self._lock.reacquire()
            if owned and self._renew_owner is not None:
                owned = self._renew_owner()
        except Exception:
            self._lost.set()
            logger.exception("Failed to renew knowledge indexing lease: %s", self._name)
            return False
        if not owned:
            self._lost.set()
        return owned

    def release(self) -> bool:
        if self._release_handoff is not None:
            try:
                return self._release_handoff()
            except Exception:
                logger.warning("Failed to release knowledge indexing handoff: %s", self._name, exc_info=True)
                return False
        try:
            self._lock.release()
        except Exception:
            logger.warning("Failed to release knowledge indexing lease: %s", self._name, exc_info=True)
            return False
        return True

    def mark_lost(self) -> None:
        self._lost.set()


class RedisKnowledgeIndexingLock:
    """Own Redis leases without allowing an expired owner to touch a replacement lock."""

    def __init__(
        self,
        *,
        redis: RedisLockClient,
        token_factory: Callable[[], str] | None = None,
        heartbeat_interval: float = 30,
        poll_interval: float = 0.1,
    ) -> None:
        self._redis = redis
        self._adopt = redis.register_script(_ADOPT_SCRIPT)
        self._handoff = redis.register_script(_HANDOFF_SCRIPT)
        self._acquire_handoff = redis.register_script(_ACQUIRE_HANDOFF_SCRIPT)
        self._mark_handoff_owner = redis.register_script(_MARK_HANDOFF_OWNER_SCRIPT)
        self._clear_handoff_owner = redis.register_script(_CLEAR_HANDOFF_OWNER_SCRIPT)
        self._token_factory = token_factory or (lambda: uuid4().hex)
        self._heartbeat_interval = heartbeat_interval
        self._poll_interval = poll_interval

    def try_acquire(self, name: str, *, timeout: int) -> KnowledgeIndexingLease | None:
        _validate_timeout(timeout)
        token = self._token_factory()
        lock = self._new_lock(name, timeout=timeout)
        if not lock.acquire(blocking=False, token=token):
            return None
        return _RedisKnowledgeIndexingLease(lock=lock, name=name, token=token)

    def try_acquire_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
    ) -> KnowledgeIndexingLease | None:
        """Acquire a producer-marked lease that a queued worker may claim."""

        _validate_timeout(timeout)
        _validate_owner_id(owner_id)
        token = self._token_factory()
        encoded_token = f"producer:{owner_id}:{token}"
        if not self._acquire_handoff(
            keys=[name, self._handoff_owner_name(name)],
            args=[owner_id, encoded_token, timeout * 1000],
        ):
            return None
        lock = self._new_lock(name, timeout=timeout)
        lock.local.token = lock.redis.get_encoder().encode(encoded_token)
        return self._handoff_lease(
            lock=lock,
            name=name,
            token=token,
            encoded_token=encoded_token,
            owner_id=owner_id,
        )

    def _try_adopt(self, name: str, *, expected_token: str, timeout: int) -> KnowledgeIndexingLease | None:
        _validate_timeout(timeout)
        token = self._token_factory()
        if not self._adopt(keys=[name], args=[expected_token, token, timeout * 1000]):
            return None

        lock = self._new_lock(name, timeout=timeout)
        # Lock has no public attach/adopt operation. The Lua script above already
        # installed this token, so initialize redis-py's local ownership state
        # exactly as Lock.acquire(token=...) would.
        lock.local.token = lock.redis.get_encoder().encode(token)
        return _RedisKnowledgeIndexingLease(lock=lock, name=name, token=token)

    def _try_handoff(self, name: str, *, timeout: int, owner_id: str) -> KnowledgeIndexingLease | None:
        _validate_timeout(timeout)
        _validate_owner_id(owner_id)
        token = self._token_factory()
        encoded_token = f"worker:{owner_id}:{token}"
        if not self._handoff(
            keys=[name, self._handoff_owner_name(name)],
            args=[owner_id, encoded_token, timeout * 1000],
        ):
            return None

        lock = self._new_lock(name, timeout=timeout)
        lock.local.token = lock.redis.get_encoder().encode(encoded_token)
        return self._handoff_lease(
            lock=lock,
            name=name,
            token=token,
            encoded_token=encoded_token,
            owner_id=owner_id,
        )

    @staticmethod
    def _handoff_owner_name(name: str) -> str:
        # Hashing ``{name}`` produces the same Redis Cluster slot as the
        # established untagged lock key whose complete value is ``name``.
        return f"{{{name}}}:handoff-owner"

    def _refresh_handoff_owner(self, name: str, *, encoded_token: str, owner_id: str) -> bool:
        return bool(
            self._mark_handoff_owner(
                keys=[name, self._handoff_owner_name(name)],
                args=[encoded_token, owner_id],
            )
        )

    def _handoff_lease(
        self,
        *,
        lock: RedisLockHandle,
        name: str,
        token: str,
        encoded_token: str,
        owner_id: str,
    ) -> KnowledgeIndexingLease:
        def release_handoff() -> bool:
            return bool(
                self._clear_handoff_owner(
                    keys=[name, self._handoff_owner_name(name)],
                    args=[encoded_token, owner_id],
                )
            )

        return _RedisKnowledgeIndexingLease(
            lock=lock,
            name=name,
            token=token,
            renew_owner=lambda: self._refresh_handoff_owner(
                name,
                encoded_token=encoded_token,
                owner_id=owner_id,
            ),
            release_handoff=release_handoff,
        )

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[KnowledgeIndexingLease]:
        deadline = time.monotonic() + max(0, blocking_timeout)
        while True:
            lease = (
                self.try_acquire(name, timeout=timeout)
                if expected_token is None
                else self._try_adopt(name, expected_token=expected_token, timeout=timeout)
            )
            if lease is not None:
                break
            if time.monotonic() >= deadline:
                raise KnowledgeIndexingLockBusyError(f"Knowledge indexing resource is busy: {name}")
            time.sleep(min(self._poll_interval, max(0, deadline - time.monotonic())))

        assert isinstance(lease, _RedisKnowledgeIndexingLease)
        stopped = threading.Event()
        heartbeat = threading.Thread(
            target=self._renew_while_held,
            args=(lease, stopped),
            daemon=True,
            name=f"KnowledgeIndexingLease({name})",
        )
        try:
            try:
                heartbeat.start()
            except RuntimeError as error:
                raise KnowledgeIndexingLockBusyError(f"Cannot start indexing heartbeat: {name}") from error
            yield lease
            lease.assert_owned()
        finally:
            stopped.set()
            if heartbeat.ident is not None:
                heartbeat.join(timeout=min(5, self._heartbeat_interval))
            if heartbeat.is_alive():
                logger.warning("Knowledge indexing lease heartbeat did not stop before release: %s", name)
            lease.release()

    @contextmanager
    def hold_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
        blocking_timeout: float = 0,
    ) -> Generator[KnowledgeIndexingLease]:
        deadline = time.monotonic() + max(0, blocking_timeout)
        while True:
            lease = self._try_handoff(name, timeout=timeout, owner_id=owner_id)
            if lease is not None:
                break
            if time.monotonic() >= deadline:
                raise KnowledgeIndexingLockBusyError(f"Knowledge indexing resource is busy: {name}")
            time.sleep(min(self._poll_interval, max(0, deadline - time.monotonic())))

        assert isinstance(lease, _RedisKnowledgeIndexingLease)
        stopped = threading.Event()
        heartbeat = threading.Thread(
            target=self._renew_while_held,
            args=(lease, stopped),
            daemon=True,
            name=f"KnowledgeIndexingLease({name})",
        )
        try:
            try:
                heartbeat.start()
            except RuntimeError as error:
                raise KnowledgeIndexingLockBusyError(f"Cannot start indexing heartbeat: {name}") from error
            yield lease
            lease.assert_owned()
        finally:
            stopped.set()
            if heartbeat.ident is not None:
                heartbeat.join(timeout=min(5, self._heartbeat_interval))
            if heartbeat.is_alive():
                logger.warning("Knowledge indexing lease heartbeat did not stop before release: %s", name)
            lease.release()

    def _new_lock(self, name: str, *, timeout: int) -> RedisLockHandle:
        return self._redis.lock(
            name,
            timeout=timeout,
            sleep=self._poll_interval,
            blocking=False,
            thread_local=False,
        )

    def _renew_while_held(self, lease: _RedisKnowledgeIndexingLease, stopped: threading.Event) -> None:
        while not stopped.wait(self._heartbeat_interval):
            if not lease.renew():
                lease.mark_lost()
                logger.error("Knowledge indexing lease ownership was lost")
                return


def _validate_timeout(seconds: int) -> None:
    if seconds < 1:
        raise ValueError("Knowledge indexing lease timeout must be positive")


def _validate_owner_id(owner_id: str) -> None:
    if not owner_id or ":" in owner_id:
        raise ValueError("Knowledge indexing handoff owner must be a non-empty identifier without colons")
