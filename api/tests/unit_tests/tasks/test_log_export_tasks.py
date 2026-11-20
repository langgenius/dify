"""Check that queued Conversation exports remain compatible with the shared worker."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.entities.conversation_entities import ConsoleConversationLogFilters
from services.retention.conversation.log_export_service import ConversationLogExportTask
from services.retention.log_export_adapters import dispatch_log_export
from tasks import log_export_tasks


def test_conversation_log_export_keeps_its_original_message(monkeypatch: pytest.MonkeyPatch) -> None:
    task = ConversationLogExportTask.pending(
        tenant_id="tenant",
        app_id="app",
        requested_by="account",
        filters=ConsoleConversationLogFilters(
            keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at"
        ),
    )
    worker = log_export_tasks.prepare_log_export_task
    publish = Mock()
    exports = Mock()
    monkeypatch.setattr(worker, "apply_async", publish)
    monkeypatch.setattr(
        log_export_tasks, "application_services", lambda: SimpleNamespace(conversation_log_exports=exports)
    )

    dispatch_log_export(task, export_kind="conversation")

    args = {"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id}
    assert worker.name == "tasks.conversation_log_export_tasks.prepare_conversation_log_export_task"
    assert worker.queue == "retention"
    publish.assert_called_once_with(kwargs=args, task_id=task.task_id, expires=task.expires_at)
    worker.run(**args)
    exports.prepare_task.assert_called_once_with(**args)
