"""Behavior tests for Organization-scoped IM write serialization."""

from __future__ import annotations

import threading
from dataclasses import dataclass

import pytest

from core.human_input_v2.shared import TenantId
from services.human_input_v2.im_contact_sync.locking import (
    OrganizationIMWriteLock,
    OrganizationIMWriteLockLostError,
    OrganizationIMWriteLockUnavailableError,
    OrganizationIMWriteScope,
)


@dataclass
class _RedisLockDouble:
    acquisition_allowed: bool = True
    token: str | None = None
    held: bool = False
    extension_seconds: float | None = None

    def acquire(
        self,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        token: str | bytes | None = None,
    ) -> bool:
        del blocking, blocking_timeout
        if not self.acquisition_allowed:
            return False
        self.token = token.decode() if isinstance(token, bytes) else token
        self.held = True
        return True

    def owned(self) -> bool:
        return self.held

    def extend(self, additional_time: float, replace_ttl: bool = False) -> bool:
        assert replace_ttl is True
        if not self.held:
            return False
        self.extension_seconds = additional_time
        return True

    def release(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")
        self.held = False


class _RedisClientDouble:
    def __init__(self, lock: _RedisLockDouble) -> None:
        self.lock_instance = lock
        self.requested_name: str | None = None
        self.requested_timeout: float | None = None
        self.requested_thread_local: bool | None = None

    def lock(self, name: str, timeout: float | None = None, thread_local: bool = True) -> _RedisLockDouble:
        self.requested_name = name
        self.requested_timeout = timeout
        self.requested_thread_local = thread_local
        return self.lock_instance


def _write_lock(lock: _RedisLockDouble | None = None) -> tuple[OrganizationIMWriteLock, _RedisClientDouble]:
    redis_client = _RedisClientDouble(lock or _RedisLockDouble())
    return (
        OrganizationIMWriteLock(
            redis_client,
            OrganizationIMWriteScope.for_workspace(TenantId("workspace-1")),
            acquisition_timeout_seconds=0.25,
            lease_seconds=5,
        ),
        redis_client,
    )


def _lose_lock_ownership(write_lock: OrganizationIMWriteLock, redis_client: _RedisClientDouble) -> None:
    with write_lock:
        redis_client.lock_instance.held = False
        write_lock.ensure_owned()


def test_workspace_and_deployment_scopes_have_stable_distinct_keys() -> None:
    assert OrganizationIMWriteScope.for_workspace(TenantId("workspace-1")).redis_key == (
        "human-input-v2:organization-im-write:workspace:workspace-1"
    )
    assert OrganizationIMWriteScope.for_deployment().redis_key == ("human-input-v2:organization-im-write:deployment")


def test_lock_uses_bounded_acquisition_finite_lease_and_owned_release() -> None:
    write_lock, redis_client = _write_lock()

    with write_lock:
        write_lock.ensure_owned()
        write_lock.extend()
        assert redis_client.lock_instance.held is True
        assert redis_client.lock_instance.token
        assert redis_client.lock_instance.extension_seconds == 5

    assert redis_client.requested_timeout == 5
    assert redis_client.requested_thread_local is True
    assert redis_client.lock_instance.held is False


def test_lock_timeout_fails_closed() -> None:
    write_lock, _ = _write_lock(_RedisLockDouble(acquisition_allowed=False))

    with pytest.raises(OrganizationIMWriteLockUnavailableError):
        with write_lock:
            raise AssertionError("unreachable")


def test_lock_ownership_loss_fails_closed() -> None:
    write_lock, redis_client = _write_lock()

    with pytest.raises(OrganizationIMWriteLockLostError):
        _lose_lock_ownership(write_lock, redis_client)


def test_lock_can_only_be_checked_by_its_acquiring_thread() -> None:
    write_lock, _ = _write_lock()
    observed_errors: list[BaseException] = []

    with write_lock:
        thread = threading.Thread(target=lambda: _capture_ownership_error(write_lock, observed_errors))
        thread.start()
        thread.join()

    assert len(observed_errors) == 1
    assert isinstance(observed_errors[0], OrganizationIMWriteLockLostError)


def _capture_ownership_error(
    write_lock: OrganizationIMWriteLock,
    observed_errors: list[BaseException],
) -> None:
    try:
        write_lock.ensure_owned()
    except OrganizationIMWriteLockLostError as error:
        observed_errors.append(error)
