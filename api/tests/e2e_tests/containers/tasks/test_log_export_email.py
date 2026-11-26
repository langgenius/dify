"""Exercise cancellation, publication, and idempotent delivery against Redis."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier

import pytest
from typing_extensions import TypedDict

from extensions.ext_redis import RedisClientWrapper
from services.retention.log_export_email import (
    _CHANGE_EMAIL_STATE,
    _CLAIM_EMAIL_DELIVERY,
    _RESTORE_EMAIL_REQUEST,
    LogExportEmailNotifications,
    LogExportEmailState,
)
from services.retention.log_export_task import LogExportKind, LogExportStatus, LogExportTask, LogExportTaskNotFoundError
from services.retention.log_export_task_cache import RedisLogExportTasks


class _Scope(TypedDict, closed=True):
    tenant_id: str
    app_id: str
    task_id: str
    export_kind: LogExportKind


class _RecordingDispatch:
    def __init__(self) -> None:
        self.calls: list[datetime] = []
        self.error: Exception | None = None

    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        export_kind: LogExportKind,
        requested_by: str,
        expires_at: datetime,
    ) -> None:
        assert (tenant_id, app_id, requested_by) == ("tenant", "app", "owner")
        assert task_id
        assert export_kind in LogExportKind
        if self.error:
            raise self.error
        self.calls.append(expires_at)


class _Export:
    def __init__(self, redis: RedisClientWrapper, kind: LogExportKind) -> None:
        self.task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
        self.scope = _Scope(tenant_id="tenant", app_id="app", task_id=self.task.task_id, export_kind=kind)
        self.keys = LogExportEmailNotifications._keys("tenant", "app", self.task.task_id, kind)
        self.tasks = RedisLogExportTasks(
            redis=redis, task_type=LogExportTask[str], key_prefix=f"{kind.value}_log_export"
        )
        self.tasks.save(self.task)
        self.dispatch = _RecordingDispatch()
        self.emails = LogExportEmailNotifications(redis=redis, dispatch=self.dispatch)

    def finish(self, status: LogExportStatus = LogExportStatus.READY) -> LogExportTask[str]:
        processing = self.tasks.claim(self.task)
        assert processing is not None
        published = self.tasks.finish(processing, status=status, storage_key="logs.csv")
        assert published is not None
        return published


@pytest.mark.parametrize("kind", list(LogExportKind))
def test_email_opt_in_can_be_canceled_while_pending_and_set_after_ready(
    application_redis: RedisClientWrapper, kind: LogExportKind
) -> None:
    export = _Export(application_redis, kind)
    emails, scope = export.emails, export.scope

    assert emails.get_state(**scope) is LogExportEmailState.OFF
    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.WAITING
    assert application_redis.pttl(export.keys[1]) == -1
    with pytest.raises(LogExportTaskNotFoundError):
        emails.set_enabled(**scope, requested_by="other", enabled=False)
    assert emails.get_state(**scope) is LogExportEmailState.WAITING
    assert emails.set_enabled(**scope, requested_by="owner", enabled=False) is LogExportEmailState.OFF
    ready = export.finish()
    assert emails.queue_if_requested(**scope, requested_by="owner") is LogExportEmailState.OFF
    assert not export.dispatch.calls

    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.QUEUED
    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.QUEUED
    assert emails.set_enabled(**scope, requested_by="owner", enabled=False) is LogExportEmailState.QUEUED
    assert emails.get_state(**scope) is LogExportEmailState.QUEUED
    assert export.dispatch.calls == [ready.expires_at]
    expiration = application_redis.register_script("return {redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2])}")
    task_ttl, email_ttl = expiration(keys=export.keys)
    assert task_ttl == email_ttl > 6 * 86400 * 1000

    assert not emails.claim_delivery(**scope, requested_by="other")
    assert emails.claim_delivery(**scope, requested_by="owner")
    assert not emails.claim_delivery(**scope, requested_by="owner")


def test_completion_and_api_opt_in_publish_once(application_redis: RedisClientWrapper) -> None:
    export = _Export(application_redis, LogExportKind.CONVERSATION)
    emails, scope = export.emails, export.scope
    processing = export.tasks.claim(export.task)
    assert processing is not None
    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.WAITING
    ready = export.tasks.finish(processing, status=LogExportStatus.READY, storage_key="logs.csv")
    assert ready is not None
    assert application_redis.pttl(export.keys[1]) > 6 * 86400 * 1000
    barrier = Barrier(2)

    def complete() -> LogExportEmailState:
        barrier.wait(timeout=5)
        return emails.queue_if_requested(**scope, requested_by="owner")

    def enable() -> LogExportEmailState:
        barrier.wait(timeout=5)
        return emails.set_enabled(**scope, requested_by="owner", enabled=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(complete)
        api = pool.submit(enable)
        assert worker.result() is api.result() is LogExportEmailState.QUEUED
    assert export.dispatch.calls == [ready.expires_at]


@pytest.mark.parametrize("status", [LogExportStatus.FAILED, LogExportStatus.CANCELED])
def test_failed_or_canceled_export_clears_email_preference(
    application_redis: RedisClientWrapper, status: LogExportStatus
) -> None:
    export = _Export(application_redis, LogExportKind.CONVERSATION)
    emails, scope = export.emails, export.scope
    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.WAITING
    if status is LogExportStatus.CANCELED:
        export.tasks.cancel(export.task)
    else:
        export.finish(status)

    assert emails.get_state(**scope) is LogExportEmailState.OFF
    assert application_redis.pttl(export.keys[1]) == -2
    assert emails.set_enabled(**scope, requested_by="owner", enabled=True) is LogExportEmailState.OFF
    assert emails.queue_if_requested(**scope, requested_by="owner") is LogExportEmailState.OFF
    assert not emails.claim_delivery(**scope, requested_by="owner")
    assert not export.dispatch.calls


def test_broker_failure_restores_opt_in_and_keeps_ready_export(application_redis: RedisClientWrapper) -> None:
    export = _Export(application_redis, LogExportKind.CONVERSATION)
    ready = export.finish()
    export.dispatch.error = OSError("broker unavailable")
    with pytest.raises(OSError, match="broker unavailable"):
        export.emails.set_enabled(**export.scope, requested_by="owner", enabled=True)

    assert export.emails.get_state(**export.scope) is LogExportEmailState.WAITING
    assert export.tasks.get(tenant_id="tenant", app_id="app", task_id=export.task.task_id) == ready
    assert not export.emails.claim_delivery(**export.scope, requested_by="owner")
    export.dispatch.error = None
    assert export.emails.queue_if_requested(**export.scope, requested_by="owner") is LogExportEmailState.QUEUED
    assert export.dispatch.calls == [ready.expires_at]


def test_redis_replays_preserve_the_claim_tokens(application_redis: RedisClientWrapper) -> None:
    export = _Export(application_redis, LogExportKind.CONVERSATION)
    export.finish()
    change = application_redis.register_script(_CHANGE_EMAIL_STATE)
    queued = change(keys=export.keys, args=["enable", "owner", "publisher"])
    assert len(queued) == 2
    assert change(keys=export.keys, args=["enable", "owner", "publisher"]) == queued
    assert change(keys=export.keys, args=["enable", "owner", "another-publisher"]) == queued[:1]

    claim = application_redis.register_script(_CLAIM_EMAIL_DELIVERY)
    assert claim(keys=export.keys, args=["owner", "mail-worker"]) == 1
    assert claim(keys=export.keys, args=["owner", "mail-worker"]) == 1
    assert claim(keys=export.keys, args=["owner", "another-mail-worker"]) == 0
    restore = application_redis.register_script(_RESTORE_EMAIL_REQUEST)
    restore(keys=[export.keys[1]], args=["publisher"])
    assert export.emails.get_state(**export.scope) is LogExportEmailState.QUEUED
