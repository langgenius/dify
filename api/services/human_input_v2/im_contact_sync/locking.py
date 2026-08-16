"""Organization-scoped Redis serialization for reconciliation-protected writes."""

from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass
from types import TracebackType
from typing import Protocol, Self

from redis.exceptions import RedisError

from core.human_input_v2.shared import TenantId

_LOCK_KEY_PREFIX = "human-input-v2:organization-im-write"


class OrganizationIMWriteLockUnavailableError(RuntimeError):
    """The Organization write lock could not be acquired within its bound."""


class OrganizationIMWriteLockLostError(RuntimeError):
    """The current thread can no longer prove ownership of the write lock."""


@dataclass(frozen=True, slots=True)
class OrganizationIMWriteScope:
    """Stable owner key resolved by the CE/SaaS or EE application boundary."""

    redis_key: str

    @classmethod
    def for_workspace(cls, tenant_id: TenantId) -> OrganizationIMWriteScope:
        return cls(f"{_LOCK_KEY_PREFIX}:workspace:{tenant_id}")

    @classmethod
    def for_deployment(cls) -> OrganizationIMWriteScope:
        return cls(f"{_LOCK_KEY_PREFIX}:deployment")


class _RedisLock(Protocol):
    def acquire(
        self,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        token: str | bytes | None = None,
    ) -> bool: ...

    def owned(self) -> bool: ...

    def extend(self, additional_time: float, replace_ttl: bool = False) -> bool: ...

    def release(self) -> None: ...


class _RedisClient(Protocol):
    def lock(
        self,
        name: str,
        timeout: float | None = None,
        *,
        thread_local: bool = True,
    ) -> _RedisLock: ...


class OrganizationIMWriteLock:
    """Finite Redis lease whose ownership is restricted to its acquiring thread."""

    def __init__(
        self,
        redis_client: _RedisClient,
        scope: OrganizationIMWriteScope,
        *,
        acquisition_timeout_seconds: float,
        lease_seconds: float,
    ) -> None:
        if acquisition_timeout_seconds < 0:
            raise ValueError("acquisition timeout must not be negative")
        if lease_seconds <= 0:
            raise ValueError("lease must be positive")
        self._lock = redis_client.lock(scope.redis_key, timeout=lease_seconds, thread_local=True)
        self._acquisition_timeout_seconds = acquisition_timeout_seconds
        self._lease_seconds = lease_seconds
        self._owner_thread_id: int | None = None
        self._token = secrets.token_hex(32)

    def __enter__(self) -> Self:
        try:
            acquired = self._lock.acquire(
                blocking=True,
                blocking_timeout=self._acquisition_timeout_seconds,
                token=self._token,
            )
        except RedisError as error:
            raise OrganizationIMWriteLockUnavailableError("Organization IM write lock is unavailable") from error
        if not acquired:
            raise OrganizationIMWriteLockUnavailableError("Organization IM write lock acquisition timed out")
        self._owner_thread_id = threading.get_ident()
        self.ensure_owned()
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exception, traceback
        if self._owner_thread_id is None:
            return
        ownership_lost = False
        try:
            ownership_lost = not self._is_owned_by_current_thread()
            if not ownership_lost:
                self._lock.release()
        except RedisError:
            ownership_lost = True
        finally:
            self._owner_thread_id = None
        if ownership_lost and exception_type is None:
            raise OrganizationIMWriteLockLostError("Organization IM write lock ownership was lost before release")

    def ensure_owned(self) -> None:
        try:
            owned = self._is_owned_by_current_thread()
        except RedisError as error:
            raise OrganizationIMWriteLockLostError("Organization IM write lock ownership cannot be verified") from error
        if not owned:
            raise OrganizationIMWriteLockLostError("Organization IM write lock ownership was lost")

    def extend(self) -> None:
        self.ensure_owned()
        try:
            extended = self._lock.extend(self._lease_seconds, replace_ttl=True)
        except RedisError as error:
            raise OrganizationIMWriteLockLostError("Organization IM write lock lease cannot be extended") from error
        if not extended:
            raise OrganizationIMWriteLockLostError("Organization IM write lock lease was not extended")

    def _is_owned_by_current_thread(self) -> bool:
        return self._owner_thread_id == threading.get_ident() and self._lock.owned()
