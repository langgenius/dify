"""Prepare a log export through the service for its log type."""

import logging

from celery import shared_task

from extensions.ext_application_services import application_services
from services.retention.log_export_task import LogExportKind

logger = logging.getLogger(__name__)


@shared_task(name="tasks.log_export_tasks.prepare_log_export_task", queue="retention")
def prepare_log_export_task(*, tenant_id: str, app_id: str, task_id: str, export_kind: str) -> None:
    """Route a saved export to the service for its log type."""
    services = application_services()
    match export_kind:
        case LogExportKind.CONVERSATION:
            exports = services.conversation_log_exports
        case LogExportKind.WORKFLOW:
            exports = services.workflow_log_exports
        case LogExportKind.AGENT:
            exports = services.agent_log_exports
        case _:
            raise ValueError(f"Unsupported log export kind: {export_kind}")

    logger.info("Preparing %s log export: tenant=%s app=%s task=%s", export_kind, tenant_id, app_id, task_id)
    exports.prepare_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
