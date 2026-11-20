"""Prepare one conversation log export through the injected export service."""

import logging

from celery import shared_task

from extensions.ext_application_services import application_services

logger = logging.getLogger(__name__)


@shared_task(queue="retention")
def prepare_conversation_log_export_task(*, tenant_id: str, app_id: str, task_id: str) -> None:
    """Load and prepare the identified export in the worker."""
    logger.info("Preparing conversation log export: tenant=%s app=%s task=%s", tenant_id, app_id, task_id)
    application_services().conversation_log_exports.prepare_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
