"""Prepare a log export through the service for its log type."""

import logging

from celery import shared_task

from extensions.ext_application_services import application_services
from services.retention.log_export_adapters import notify_log_export_ready
from services.retention.log_export_task import LogExportKind, LogExportLeaseBusyError

logger = logging.getLogger(__name__)


@shared_task(
    name="tasks.log_export_tasks.prepare_log_export_task",
    queue="retention",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(LogExportLeaseBusyError,),
    retry_backoff=5,
    retry_backoff_max=60,
    max_retries=None,
)
def prepare_log_export_task(*, tenant_id: str, app_id: str, task_id: str, export_kind: str) -> None:
    """Prepare a saved export and notify its requester after this attempt publishes the ready CSV."""
    services = application_services()
    kind = LogExportKind(export_kind)
    match kind:
        case LogExportKind.CONVERSATION:
            exports = services.conversation_log_exports
        case LogExportKind.WORKFLOW:
            exports = services.workflow_log_exports
        case LogExportKind.AGENT:
            exports = services.agent_log_exports

    logger.info("Preparing %s log export: tenant=%s app=%s task=%s", export_kind, tenant_id, app_id, task_id)
    ready_task = exports.prepare_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
    if ready_task is None:
        return

    try:
        services.log_export_email_notifications.queue_if_requested(
            tenant_id=ready_task.tenant_id,
            app_id=ready_task.app_id,
            task_id=ready_task.task_id,
            requested_by=ready_task.requested_by,
            export_kind=kind,
        )
    except Exception:
        logger.exception("Could not queue log export email: tenant=%s app=%s task=%s", tenant_id, app_id, task_id)
    try:
        notify_log_export_ready(ready_task, export_kind=kind)
    except Exception:
        logger.exception(
            "Could not notify requester after exporting logs: tenant=%s app=%s task=%s", tenant_id, app_id, task_id
        )
