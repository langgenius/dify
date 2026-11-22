"""Check that queued Conversation exports remain compatible with the shared worker."""

from unittest.mock import MagicMock, patch

from flask import Flask

from extensions.ext_application_services import application_services, init_app
from services.entities.conversation_entities import ConsoleConversationLogFilters
from services.retention.conversation.log_export_service import ConversationLogExportTask
from services.retention.log_export_adapters import dispatch_log_export
from services.retention.log_export_task import LogExportKind
from tasks import log_export_tasks
from tests.helpers.unit.tasks.task_options import task_options


def test_conversation_log_export_keeps_its_original_message(log_export_publish: MagicMock) -> None:
    task = ConversationLogExportTask.pending(
        tenant_id="tenant",
        app_id="app",
        requested_by="account",
        filters=ConsoleConversationLogFilters(
            keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at"
        ),
    )
    worker = log_export_tasks.prepare_log_export_task
    app = Flask(__name__)
    init_app(app)

    dispatch_log_export(task, export_kind=LogExportKind.CONVERSATION)

    args = {"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id}
    assert worker.name == "tasks.conversation_log_export_tasks.prepare_conversation_log_export_task"
    assert task_options(worker)["queue"] == "retention"
    log_export_publish.assert_called_once_with(kwargs=args, task_id=task.task_id, expires=task.expires_at)
    with app.app_context(), patch.object(application_services().conversation_log_exports, "prepare_task") as prepare:
        worker.run(**args)
        prepare.assert_called_once_with(**args)
