from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from typing import TextIO
from unittest.mock import call, create_autospec
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from redis.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ClusterDownError,
    ClusterError,
    ConnectionError,
    DataError,
    NoPermissionError,
    ReadOnlyError,
    ResponseError,
    SlotNotCoveredError,
    TimeoutError,
    TryAgainError,
)

from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from services.entities.conversation_entities import ConsoleLogIdentitySource
from services.retention import log_export_task
from services.retention.log_export_adapters import (
    _LOG_EXPORT_NOTIFICATION_COPY,
    _log_export_notice_markdown,
    store_log_export_csv,
)
from services.retention.log_export_csv import CsvRowProgress, write_log_export_csv
from services.retention.log_export_task import (
    LogExportIdentityLabel,
    LogExportLeaseBusyError,
    LogExportProgress,
    LogExportStage,
    LogExportStatus,
    LogExportTask,
    LogExportTaskStore,
)
from services.retention.log_export_task_cache import RedisLogExportTasks
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters, WorkflowLogExportTask
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo


def _write_csv(
    _context: RequestContext, _app_id: str, /, *, filters: str, output: TextIO, report_rows: CsvRowProgress
) -> int:
    return write_log_export_csv(output, [{"query": filters}], columns=("query",), report_rows=report_rows)


@pytest.mark.parametrize(("error_type", "renew_calls"), [(LogExportLeaseBusyError, 3), (ResponseError, 1)])
def test_heartbeat_only_retries_transient_failures(
    error_type: type[Exception], renew_calls: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Renew again after a temporary failure and stop on lease loss or a permanent error."""
    stopped = create_autospec(Event, instance=True)
    stopped.wait.side_effect = [False, False, False, True]
    monkeypatch.setattr(log_export_task, "Event", lambda: stopped)
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    store = create_autospec(LogExportTaskStore, instance=True)
    store.renew.side_effect = [error_type("lease renewal failed"), True, False]

    with log_export_task._renew_export_lease(task, store, read_rows=lambda: 7):
        pass

    progress = LogExportProgress(stage=LogExportStage.WRITING, rows_written=7)
    assert store.renew.call_args_list == [call(task, progress=progress)] * renew_calls
    assert stopped.wait.call_count == renew_calls


def test_worker_records_total_rows_before_upload(
    log_export_redis: LogExportRedisIo, log_export_storage: LogExportStorageIo
) -> None:
    """Expose the exact row count during upload and keep it on the completed task."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    uploading = LogExportProgress(stage=LogExportStage.UPLOADING, rows_written=1)

    def check_upload(_key: str, path: Path) -> None:
        current = tasks.get_latest(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        assert current is not None
        assert current.status is LogExportStatus.PROCESSING
        assert current.expires_at == task.expires_at
        assert current.progress == uploading
        assert path.read_text(encoding="utf-8-sig").splitlines() == ['"query"', '"all"']

    log_export_storage.save_from_path.side_effect = check_upload
    ready = log_export_task.prepare_log_export_task(
        task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
    )

    log_export_storage.save_from_path.assert_called_once()
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.status is LogExportStatus.READY
    assert current.expires_at is not None
    assert current.expires_at > task.created_at + timedelta(days=7)
    assert current.progress == uploading
    assert ready == current
    assert (
        log_export_task.prepare_log_export_task(
            current, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )
        is None
    )
    log_export_storage.save_from_path.assert_called_once()


def test_notification_markdown_formats_workflow_filters_as_literal_text() -> None:
    """Render Workflow filters in the account timezone, escaping values and using the actual row count."""
    identity_id = uuid4()
    task = WorkflowLogExportTask.pending(
        tenant_id="tenant",
        app_id="app",
        requested_by="owner",
        filters=WorkflowLogExportFilters(
            keyword="::card [customer](https://example.com) <label>",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_at_after=datetime(2026, 11, 20),
            account_ids=(str(identity_id),),
        ),
        identity_labels=(
            LogExportIdentityLabel(id=identity_id, source=ConsoleLogIdentitySource.ACCOUNT, label="Review\naccount"),
        ),
        estimated_rows=12,
    ).model_copy(
        update={
            "status": LogExportStatus.READY,
            "progress": LogExportProgress(stage=LogExportStage.UPLOADING, rows_written=10),
            "expires_at": datetime(2026, 11, 27, 9, 30, tzinfo=UTC),
        }
    )

    markdown = _log_export_notice_markdown(
        task, sources=[], timezone=ZoneInfo("Asia/Shanghai"), copy=_LOG_EXPORT_NOTIFICATION_COPY["en-US"]
    )
    assert markdown.split("\n\n") == [
        r"**Time range** — From 2026\-11\-20 08\:00",
        "**Status** — Success",
        r"**Search** — \:\:card \[customer\]\(https\:\/\/example\.com\) &lt;label&gt;",
        "**End user or account** — Review account",
        "**CSV rows** — 10",
        r"**Expires** — 2026\-11\-27 17\:30",
    ]


@pytest.mark.parametrize(
    ("redis_error_type", "retryable"),
    [
        (ConnectionError, True),
        (TimeoutError, True),
        (ClusterDownError, True),
        (ClusterError, True),
        (SlotNotCoveredError, True),
        (OSError, True),
        (BrokenPipeError, True),
        (ReadOnlyError, True),
        (TryAgainError, True),
        (ResponseError, False),
        (DataError, False),
        (AuthenticationError, False),
        (AuthorizationError, False),
        (NoPermissionError, False),
    ],
)
def test_final_renewal_error_respects_retry_policy(
    redis_error_type: type[Exception],
    retryable: bool,
    log_export_redis: LogExportRedisIo,
    log_export_storage: LogExportStorageIo,
) -> None:
    """Keep temporary failures reclaimable and preserve permanent Redis errors."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    renewal_error = redis_error_type("lease renewal failed")
    log_export_redis.renew_error = renewal_error

    expected_error = LogExportLeaseBusyError if retryable else redis_error_type
    with pytest.raises(expected_error) as failure:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    assert (failure.value.__cause__ if retryable else failure.value) is renewal_error
    assert log_export_redis.renew_calls == 1
    log_export_storage.save_from_path.assert_not_called()
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    expected_status = LogExportStatus.PROCESSING if retryable else LogExportStatus.FAILED
    assert current.status is expected_status
    assert current.storage_key is None


def test_failure_recording_error_preserves_permanent_renewal_error(
    log_export_redis: LogExportRedisIo, log_export_storage: LogExportStorageIo
) -> None:
    """Keep the renewal error when Redis also refuses to record the failure."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    renewal_error = AuthenticationError("renew authentication failed")
    log_export_redis.renew_error = renewal_error
    log_export_redis.finish_error = AuthenticationError("finish authentication failed")

    with pytest.raises(AuthenticationError) as failure:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    assert failure.value is renewal_error
    log_export_storage.save_from_path.assert_not_called()


def test_storage_failure_retries_when_recording_failed_hits_transient_redis_error(
    log_export_redis: LogExportRedisIo, log_export_storage: LogExportStorageIo
) -> None:
    """Surface the retryable state write error after an upload failure."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    log_export_storage.save_from_path.side_effect = OSError("CSV upload failed")
    finish_error = ConnectionError("Redis temporarily unavailable")
    log_export_redis.finish_error = finish_error

    with pytest.raises(LogExportLeaseBusyError) as retry:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    log_export_storage.save_from_path.assert_called_once()
    assert retry.value.__cause__ is finish_error
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.status is LogExportStatus.PROCESSING
    assert current.storage_key is None


def test_dispatch_failure_leaves_pending_export_available_for_recovery(log_export_redis: LogExportRedisIo) -> None:
    """Persist the task before attempting delivery so recovery can republish after a broker error."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    dispatch_error = RuntimeError("Broker unavailable")

    def dispatch(tenant_id: str) -> None:
        assert tenant_id == task.tenant_id
        assert tasks.get_latest(tenant_id=tenant_id, app_id=task.app_id, requested_by=task.requested_by) == task
        raise dispatch_error

    with pytest.raises(RuntimeError) as failure:
        log_export_task.save_and_dispatch_log_export_task(task, tasks=tasks, dispatch=dispatch)

    assert failure.value is dispatch_error
    assert tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id) == task


def test_create_dispatches_only_the_head_export_in_a_workspace(log_export_redis: LogExportRedisIo) -> None:
    """Put later submissions in the workspace queue without publishing them to the broker."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    first = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    waiting = LogExportTask[str].pending(tenant_id="tenant", app_id="other", requested_by="owner", filters="all")
    dispatched: list[str] = []
    log_export_task.save_and_dispatch_log_export_task(first, tasks=tasks, dispatch=dispatched.append)
    log_export_task.save_and_dispatch_log_export_task(waiting, tasks=tasks, dispatch=dispatched.append)

    assert dispatched == [first.tenant_id]
    assert tasks.get(tenant_id=waiting.tenant_id, app_id=waiting.app_id, task_id=waiting.task_id) == waiting
