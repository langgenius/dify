"""Celery owns execution; durable KnowledgeFS leases own resource state and retry policy."""

import logging
import time

from celery import shared_task
from celery.exceptions import Reject
from celery.signals import worker_process_shutdown

from configs import dify_config
from services.knowledge_fs.background_contract import (
    DELIVERY_TASK,
    DOCUMENT_QUEUE,
    MAINTENANCE_QUEUE,
    OPERATION_QUEUES,
    OPERATION_TASK,
    BackgroundJobPayload,
)
from services.knowledge_fs.background_engine import background_engine

logger = logging.getLogger(__name__)


@worker_process_shutdown.connect
def close_background_engine(**_: object) -> None:
    background_engine.close()


@shared_task(
    name=DELIVERY_TASK,
    bind=True,
    queue=DOCUMENT_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=None,
    soft_time_limit=dify_config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS,
    time_limit=dify_config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS + 30,
)
def execute_delivery(self, *, delivery: dict[str, object]) -> dict[str, object]:
    try:
        locator = BackgroundJobPayload.model_validate(delivery)
    except ValueError as error:
        raise Reject("Invalid KnowledgeFS background locator", requeue=False) from error
    if str(locator.id) != self.request.id:
        raise Reject("KnowledgeFS broker delivery identity mismatch", requeue=False)
    envelope = locator.model_dump(mode="json", exclude={"runAfter"})
    envelope["attempts"] = self.request.retries + 1
    logger.info("KnowledgeFS Celery delivery type=%s delivery_id=%s", locator.type, locator.id)
    try:
        result = background_engine.execute("delivery", envelope)
    except Exception as error:
        raise self.retry(exc=error, countdown=min(300, 5 * 2 ** min(self.request.retries, 6))) from error
    if result.get("outcome") == "retry":
        run_after = result.get("runAfter")
        delay = max(1.0, (float(run_after) / 1000 - time.time()) if isinstance(run_after, (int, float)) else 5.0)
        raise self.retry(countdown=min(delay, 86_400))
    if result.get("outcome") == "failed":
        raise Reject("KnowledgeFS rejected the background delivery", requeue=False)
    return result


@shared_task(
    name=OPERATION_TASK,
    bind=True,
    queue=MAINTENANCE_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=5,
    soft_time_limit=dify_config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS,
    time_limit=dify_config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS + 30,
)
def execute_operation(self, *, operation: str) -> dict[str, object]:
    if not isinstance(operation, str) or operation not in OPERATION_QUEUES:
        raise Reject("Unknown KnowledgeFS background operation", requeue=False)
    try:
        return background_engine.execute(operation)
    except Exception as error:
        raise self.retry(exc=error, countdown=min(300, 5 * 2 ** min(self.request.retries, 6))) from error
