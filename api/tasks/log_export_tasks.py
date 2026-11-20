"""Prepare a log export through the service for its log type."""

import logging

from celery import shared_task

from extensions.ext_application_services import application_services
from services.retention.log_export_task import LogExportKind

logger = logging.getLogger(__name__)


# Keep the existing task name and default for Conversation messages already on the queue.
@shared_task(name="tasks.conversation_log_export_tasks.prepare_conversation_log_export_task", queue="retention")
def prepare_log_export_task(
    *, tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind = "conversation"
) -> None:
    """Route a saved export to its service. Legacy messages without an export kind are Conversation tasks."""
    services = application_services()
    match export_kind:
        case "conversation":
            exports = services.conversation_log_exports
        case "workflow":
            exports = services.workflow_log_exports
        case _:
            raise ValueError(f"Unsupported log export kind: {export_kind}")

    logger.info("Preparing %s log export: tenant=%s app=%s task=%s", export_kind, tenant_id, app_id, task_id)
    exports.prepare_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
