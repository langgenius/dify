import logging

from celery import shared_task

from configs import dify_config
from services.rag_pipeline.tenant_task_queue import RagPipelineTenantTaskQueue, dispatch_rag_pipeline_claims

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_executor")
def recover_rag_pipeline_tenant_queue() -> None:
    """Republish queue claims whose publisher or worker stopped renewing its lease."""

    for tenant_id in RagPipelineTenantTaskQueue.registered_tenants():
        try:
            queue = RagPipelineTenantTaskQueue(tenant_id)
            claims = queue.recover(concurrency=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)
            dispatch_rag_pipeline_claims(tenant_id=tenant_id, queue=queue, claims=claims)
        except Exception:
            logger.exception("Failed to recover RAG pipeline tenant queue: %s", tenant_id)
