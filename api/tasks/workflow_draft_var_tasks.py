"""Retry reclamation of uploads from deleted variables or failed variable saves."""

import logging

from celery import shared_task  # type: ignore[import-untyped]

from core.db.session_factory import session_factory

logger = logging.getLogger(__name__)


@shared_task(
    queue="workflow_storage",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def cleanup_draft_variable_files_task(upload_file_ids: list[str]) -> None:
    """Resolve persisted UploadFile IDs, including uploads with no variable metadata."""
    from extensions.application_services.workflow_variables import build_workflow_variable_service

    logger.info("Cleaning draft uploads, upload_file_ids=%s", upload_file_ids)
    build_workflow_variable_service(database_client=session_factory.get_session_maker()).cleanup_files(upload_file_ids)


@shared_task(queue="workflow_storage")
def recover_draft_variable_file_cleanup_task() -> None:
    """Recover committed requests after broker outages, worker loss or exhausted retries."""
    from extensions.application_services.workflow_variables import build_workflow_variable_service

    build_workflow_variable_service(database_client=session_factory.get_session_maker()).retry_file_cleanup(limit=100)
