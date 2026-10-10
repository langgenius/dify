import logging
import time

from celery import shared_task

from services.annotation_import_service import AnnotationImportRecord

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def batch_import_annotations_task(
    job_id: str, content_list: list[AnnotationImportRecord], app_id: str, tenant_id: str, user_id: str
) -> None:
    """Import a detached batch and publish its outcome after indexing and SQL finish."""
    from extensions.ext_application_services import application_services

    service = application_services().annotation_imports
    start_at = time.perf_counter()
    logger.info("Import annotation job %s for app %s in tenant %s", job_id, app_id, tenant_id)
    try:
        service.execute_import(
            tenant_id=tenant_id,
            app_id=app_id,
            job_id=job_id,
            account_id=user_id,
            records=content_list,
        )
    except Exception as error:
        logger.exception("Annotation import job %s failed for app %s in tenant %s", job_id, app_id, tenant_id)
        service.complete_job(tenant_id=tenant_id, app_id=app_id, job_id=job_id, error=str(error))
    else:
        service.complete_job(tenant_id=tenant_id, app_id=app_id, job_id=job_id, error=None)
        logger.info(
            "Imported annotation job %s for app %s in tenant %s in %.3fs",
            job_id,
            app_id,
            tenant_id,
            time.perf_counter() - start_at,
        )
