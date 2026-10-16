import threading
from unittest.mock import MagicMock, patch

import pytest
from redis.lock import Lock

from extensions.ext_redis import RedisClientWrapper
from services.retention.workflow_run import archive_month_lock
from services.retention.workflow_run.archive_month_lock import (
    RedisWorkflowRunArchiveMonthLock,
    WorkflowRunArchiveMonthBusyError,
)


def test_month_lease_renews_during_blocking_work_and_releases_afterwards(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    redis, commands = redis_transport
    renewed = threading.Event()
    monkeypatch.setattr(archive_month_lock, "_RENEW_INTERVAL_SECONDS", 0.001)

    with (
        patch.object(Lock, "acquire", autospec=True, return_value=True) as acquire,
        patch.object(Lock, "owned", return_value=True),
        patch.object(Lock, "reacquire", side_effect=renewed.set),
        patch.object(Lock, "release") as release,
    ):
        with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3) as lease:
            assert renewed.wait(timeout=1)
            lease.assert_owned()
            release.assert_not_called()
        acquire.assert_called_once()
        release.assert_called_once()

    lock = acquire.call_args.args[0]
    assert isinstance(lock, Lock)
    assert lock.name == "workflow_run_archive_month:tenant-1:2025-03"
    assert lock.timeout == 120
    assert lock.blocking_timeout == 120
    assert lock.thread_local is False
    commands.assert_not_called()


def test_failed_renewal_prevents_committing_archive_deletion(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    redis, commands = redis_transport
    attempted = threading.Event()
    renewal_threads: list[threading.Thread] = []

    def fail_renewal() -> None:
        renewal_threads.append(threading.current_thread())
        attempted.set()
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(archive_month_lock, "_RENEW_INTERVAL_SECONDS", 0.001)
    with (
        patch.object(Lock, "acquire", return_value=True),
        patch.object(Lock, "reacquire", side_effect=fail_renewal),
        patch.object(Lock, "release") as release,
    ):
        with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3) as lease:
            assert attempted.wait(timeout=1)
            # Join only the heartbeat: the failed renewal must stop it and record lease loss before finalization.
            renewal_threads[0].join(timeout=1)
            with pytest.raises(RuntimeError, match="lock was lost"):
                lease.assert_owned()
        release.assert_called_once()
    commands.assert_not_called()


def test_contended_month_lease_is_retryable(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport

    with patch.object(Lock, "acquire", return_value=False), patch.object(Lock, "release") as release:
        with pytest.raises(WorkflowRunArchiveMonthBusyError):
            with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3):
                pytest.fail("contended lease must not enter storage work")

        release.assert_not_called()
    commands.assert_not_called()
