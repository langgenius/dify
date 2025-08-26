import logging

from celery import shared_task  # type: ignore

from configs.scheduler_config import upload_scheduler_config
from extensions.ext_redis import redis_client
from services.upload_scheduler_service import UploadSchedulerService

logger = logging.getLogger(__name__)


@shared_task(name="process_upload_queue", queue="upload")
def process_upload_queue():
    """Process pending document uploads in queue."""
    if not upload_scheduler_config.enabled:
        return

    queue_pattern = f"{UploadSchedulerService.QUEUE_KEY_PREFIX}*"
    queue_keys = redis_client.keys(queue_pattern)

    for queue_key in queue_keys:
        tenant_id = queue_key.decode("utf-8").replace(UploadSchedulerService.QUEUE_KEY_PREFIX, "")

        try:
            processed_tasks = UploadSchedulerService.process_queue(tenant_id)

            if processed_tasks:
                logger.info("Processed %s uploads for tenant %s", str(len(processed_tasks)), tenant_id)

        except Exception as e:
            logger.exception("Error processing queue for tenant %s", tenant_id)
            continue
