"""Lease lifetime and failure behavior with the real redis-py Lock class."""

from threading import Event, Thread, current_thread
from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import LockNotOwnedError, RedisError
from redis.lock import Lock

from extensions.ext_redis import RedisClientWrapper
from services.credentials import redis_refresh_lock
from services.credentials.redis_refresh_lock import RedisCredentialRefreshLock
from services.credentials.refresh import CredentialRefreshUnavailableError


def test_lease_renews_during_blocking_refresh_and_releases_on_error(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    redis, _ = redis_transport
    renewed = Event()
    monkeypatch.setattr(redis_refresh_lock, "_RENEW_SECONDS", 0.001)
    with (
        patch.object(Lock, "acquire", autospec=True, return_value=True) as acquire,
        patch.object(Lock, "reacquire", side_effect=renewed.set),
        patch.object(Lock, "release") as release,
    ):

        def refresh() -> None:
            with RedisCredentialRefreshLock(client=redis).acquire(
                credential_type="tool", workspace_id="workspace", credential_id="credential"
            ) as lease:
                assert renewed.wait(timeout=1)
                lease.ensure_owned()
                release.assert_not_called()
                raise ValueError("provider failed")

        with pytest.raises(ValueError, match="provider failed"):
            refresh()
        release.assert_called_once()
    lock = acquire.call_args.args[0]
    assert lock.name == "oauth:credential-refresh:tool:workspace:credential"
    assert lock.timeout == 60
    assert lock.blocking_timeout == 30
    assert lock.thread_local is False


@pytest.mark.parametrize("error", [LockNotOwnedError("expired"), RedisError("unavailable")])
def test_lost_heartbeat_fails_closed(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch, error: RedisError
) -> None:
    redis, _ = redis_transport
    attempted = Event()
    threads: list[Thread] = []

    def fail_renewal() -> None:
        threads.append(current_thread())
        attempted.set()
        raise error

    monkeypatch.setattr(redis_refresh_lock, "_RENEW_SECONDS", 0.001)
    with (
        patch.object(Lock, "acquire", return_value=True),
        patch.object(Lock, "reacquire", side_effect=fail_renewal),
        patch.object(Lock, "release", side_effect=LockNotOwnedError("expired")),
    ):
        with RedisCredentialRefreshLock(client=redis).acquire(
            credential_type="datasource", workspace_id="workspace", credential_id="credential"
        ) as lease:
            assert attempted.wait(timeout=1)
            threads[0].join(timeout=1)
            with pytest.raises(CredentialRefreshUnavailableError):
                lease.ensure_owned()


@pytest.mark.parametrize("error", [None, RedisError("unavailable")])
def test_busy_or_unavailable_lock_never_enters_refresh(
    redis_transport: tuple[RedisClientWrapper, MagicMock], error: RedisError | None
) -> None:
    redis, _ = redis_transport
    with (
        patch.object(Lock, "acquire", return_value=False, side_effect=error),
        patch.object(Lock, "release") as release,
    ):
        with pytest.raises(CredentialRefreshUnavailableError):
            with RedisCredentialRefreshLock(client=redis).acquire(
                credential_type="tool", workspace_id="workspace", credential_id="credential"
            ):
                pytest.fail("Refresh must not run without its lease")
        release.assert_not_called()
