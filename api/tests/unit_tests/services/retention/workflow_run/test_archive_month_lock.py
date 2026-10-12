import threading
from unittest.mock import MagicMock

import pytest

from services.retention.workflow_run import archive_month_lock
from services.retention.workflow_run.archive_month_lock import (
    RedisWorkflowRunArchiveMonthLock,
    WorkflowRunArchiveMonthBusyError,
)


def test_month_lease_renews_during_blocking_work_and_releases_afterwards(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MagicMock()
    lock = redis.lock.return_value
    renewed = threading.Event()
    lock.reacquire.side_effect = renewed.set
    monkeypatch.setattr(archive_month_lock, "_RENEW_INTERVAL_SECONDS", 0.001)

    with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3) as lease:
        assert renewed.wait(timeout=1)
        lease.assert_owned()

    redis.lock.assert_called_once_with(
        "workflow_run_archive_month:tenant-1:2025-03",
        timeout=120,
        blocking_timeout=120,
        thread_local=False,
    )
    lock.release.assert_called_once()


def test_failed_renewal_prevents_committing_archive_deletion(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MagicMock()
    lock = redis.lock.return_value
    attempted = threading.Event()
    renewal_threads: list[threading.Thread] = []

    def fail_renewal() -> None:
        renewal_threads.append(threading.current_thread())
        attempted.set()
        raise RuntimeError("redis unavailable")

    lock.reacquire.side_effect = fail_renewal
    monkeypatch.setattr(archive_month_lock, "_RENEW_INTERVAL_SECONDS", 0.001)
    with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3) as lease:
        assert attempted.wait(timeout=1)
        # Join only the heartbeat: the failed renewal must stop it and record lease loss before finalization.
        renewal_threads[0].join(timeout=1)
        with pytest.raises(RuntimeError, match="lock was lost"):
            lease.assert_owned()


def test_contended_month_lease_is_retryable() -> None:
    redis = MagicMock()
    redis.lock.return_value.acquire.return_value = False

    with pytest.raises(WorkflowRunArchiveMonthBusyError):
        with RedisWorkflowRunArchiveMonthLock(redis=redis)(tenant_id="tenant-1", year=2025, month=3):
            pytest.fail("contended lease must not enter storage work")

    redis.lock.return_value.release.assert_not_called()
