import logging
import time

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def enable_annotation_reply_task(
    job_id: str,
    app_id: str,
    user_id: str,
    tenant_id: str,
    score_threshold: float,
    embedding_provider_name: str,
    embedding_model_name: str,
) -> None:
    """Enable reply and publish its terminal job state after indexing and SQL finish."""
    from extensions.ext_application_services import application_services

    service = application_services().annotation_reply
    start_at = time.perf_counter()
    logger.info("Enable annotation reply job %s for app %s in tenant %s", job_id, app_id, tenant_id)
    try:
        service.execute_enable(
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=user_id,
            score_threshold=score_threshold,
            embedding_provider_name=embedding_provider_name,
            embedding_model_name=embedding_model_name,
        )
    except Exception as error:
        logger.exception("Annotation reply job %s failed for app %s in tenant %s", job_id, app_id, tenant_id)
        service.complete_job(tenant_id=tenant_id, app_id=app_id, action="enable", job_id=job_id, error=str(error))
    else:
        service.complete_job(tenant_id=tenant_id, app_id=app_id, action="enable", job_id=job_id, error=None)
        logger.info(
            "Enabled annotation reply job %s for app %s in tenant %s in %.3fs",
            job_id,
            app_id,
            tenant_id,
            time.perf_counter() - start_at,
        )
