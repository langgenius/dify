import logging
import time

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def update_annotation_to_index_task(
    annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
) -> None:
    """Execute a queued index update, retaining the task payload for rolling upgrades."""
    from extensions.ext_application_services import application_services

    start_at = time.perf_counter()
    logger.info(
        "Start annotation index update for annotation %s in app %s, tenant %s", annotation_id, app_id, tenant_id
    )
    try:
        application_services().annotation_commands.execute_index_update(
            annotation_id=annotation_id,
            question=question,
            tenant_id=tenant_id,
            app_id=app_id,
            collection_binding_id=collection_binding_id,
        )
    except Exception:
        logger.exception(
            "Annotation index update failed for annotation %s in app %s, tenant %s", annotation_id, app_id, tenant_id
        )
    else:
        logger.info(
            "Finished annotation index update for annotation %s in app %s, tenant %s in %.3fs",
            annotation_id,
            app_id,
            tenant_id,
            time.perf_counter() - start_at,
        )
