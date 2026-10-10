import logging
import time

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def disable_annotation_reply_task(job_id: str, app_id: str, tenant_id: str) -> None:
    """Disable reply and publish its terminal job state after the setting is removed."""
    from extensions.ext_application_services import application_services

    service = application_services().annotation_reply
    start_at = time.perf_counter()
    logger.info("Disable annotation reply job %s for app %s in tenant %s", job_id, app_id, tenant_id)
    try:
        service.execute_disable(tenant_id=tenant_id, app_id=app_id)
    except Exception as error:
        logger.exception("Annotation reply job %s failed for app %s in tenant %s", job_id, app_id, tenant_id)
        service.complete_job(tenant_id=tenant_id, app_id=app_id, action="disable", job_id=job_id, error=str(error))
    else:
        service.complete_job(tenant_id=tenant_id, app_id=app_id, action="disable", job_id=job_id, error=None)
        logger.info(
            "Disabled annotation reply job %s for app %s in tenant %s in %.3fs",
            job_id,
            app_id,
            tenant_id,
            time.perf_counter() - start_at,
        )
