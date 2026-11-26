"""Check that Conversation exports are delivered through the shared task."""

from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry
from flask import Flask
from redis.exceptions import AuthenticationError, NoPermissionError, ResponseError, SlotNotCoveredError

from extensions import ext_application_services
from extensions.ext_application_services import application_services, init_app
from services.entities.conversation_entities import ConsoleConversationLogFilters
from services.retention.conversation.log_export_service import ConversationLogExportTask
from services.retention.log_export_adapters import dispatch_log_export_head
from services.retention.log_export_task import LogExportLeaseBusyError, LogExportStatus
from services.retention.log_export_task_cache import RedisLogExportTasks
from tasks import log_export_tasks
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo
from tests.helpers.unit.tasks.task_options import task_options


@pytest.fixture
def conversation_export_task() -> ConversationLogExportTask:
    """Build a pending task routed to the Conversation export service."""
    return ConversationLogExportTask.pending(
        tenant_id="tenant",
        app_id="app",
        requested_by="account",
        filters=ConsoleConversationLogFilters(
            keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at"
        ),
    )


def test_conversation_log_export_uses_shared_task(
    log_export_publish: MagicMock,
    log_export_redis: LogExportRedisIo,
    conversation_export_task: ConversationLogExportTask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = conversation_export_task
    worker = log_export_tasks.prepare_log_export_task
    app = Flask(__name__)
    init_app(app)
    monkeypatch.setattr(log_export_tasks, "redis_client", log_export_redis.client)
    store = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=ConversationLogExportTask, key_prefix="conversation_log_export"
    )
    store.save(task)

    dispatch_log_export_head(task.tenant_id, redis=log_export_redis.client)

    args = {"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id}
    message = {**args, "export_kind": "conversation"}
    assert worker.name == "tasks.log_export_tasks.prepare_log_export_task"
    assert task_options(worker)["queue"] == "retention"
    assert worker.acks_late
    assert worker.reject_on_worker_lost
    log_export_publish.assert_called_once_with(kwargs=message, task_id=task.task_id)

    with (
        app.app_context(),
        patch.object(application_services().conversation_log_exports, "prepare_task", return_value=None) as prepare,
    ):
        worker.run(**message)
        prepare.assert_called_once_with(**args)


@pytest.mark.parametrize("command", ["get", "claim"])
@pytest.mark.parametrize(
    ("redis_error_type", "retryable"),
    [
        (SlotNotCoveredError, True),
        (BrokenPipeError, True),
        (AuthenticationError, False),
        (NoPermissionError, False),
        (ResponseError, False),
    ],
)
def test_worker_retries_only_transient_redis_failures(
    command: str,
    redis_error_type: type[Exception],
    retryable: bool,
    monkeypatch: pytest.MonkeyPatch,
    log_export_redis: LogExportRedisIo,
    conversation_export_task: ConversationLogExportTask,
) -> None:
    """Exercise Celery retry through the real task and state adapter before export begins."""
    task = conversation_export_task
    store = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=ConversationLogExportTask, key_prefix="conversation_log_export"
    )
    store.save(task)
    error = redis_error_type("Redis operation failed")
    if command == "get":
        log_export_redis.get.side_effect = error
    else:
        log_export_redis.claim_error = error

    monkeypatch.setattr(ext_application_services, "redis_client", log_export_redis.client)
    monkeypatch.setattr(log_export_tasks, "redis_client", log_export_redis.client)
    app = Flask(__name__)
    init_app(app)
    worker = log_export_tasks.prepare_log_export_task
    with (
        app.app_context(),
        patch.object(worker, "retry", side_effect=Retry()) as retry,
        pytest.raises(Retry if retryable else redis_error_type) as failure,
    ):
        worker.run(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id, export_kind="conversation")

    if retryable:
        retry.assert_called_once()
        retry_error = retry.call_args.kwargs["exc"]
        assert isinstance(retry_error, LogExportLeaseBusyError)
        assert retry_error.__cause__ is error
    else:
        assert failure.value is error
        retry.assert_not_called()


def test_worker_dispatches_next_workspace_export_after_failure(
    log_export_publish: MagicMock,
    log_export_redis: LogExportRedisIo,
    conversation_export_task: ConversationLogExportTask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publish the next waiting export when the previous attempt records a terminal failure."""
    first = conversation_export_task
    second = first.model_copy(update={"task_id": "next", "app_id": "other-app"})
    monkeypatch.setattr(log_export_tasks, "redis_client", log_export_redis.client)
    store = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=ConversationLogExportTask, key_prefix="conversation_log_export"
    )
    assert store.save(first)
    assert not store.save(second)

    def prepare_task(**_scope: str) -> None:
        processing = store.claim(first)
        assert processing is not None
        assert store.finish(processing, status=LogExportStatus.FAILED) is not None
        raise OSError("CSV upload failed")

    app = Flask(__name__)
    init_app(app)
    with (
        app.app_context(),
        patch.object(application_services().conversation_log_exports, "prepare_task", new=prepare_task),
        pytest.raises(OSError, match="CSV upload failed"),
    ):
        log_export_tasks.prepare_log_export_task.run(
            tenant_id=first.tenant_id, app_id=first.app_id, task_id=first.task_id, export_kind="conversation"
        )

    log_export_publish.assert_called_once_with(
        kwargs={
            "tenant_id": second.tenant_id,
            "app_id": second.app_id,
            "task_id": second.task_id,
            "export_kind": "conversation",
        },
        task_id=second.task_id,
    )
