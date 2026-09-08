"""Publish bounded locators using Dify's configured Celery broker, TLS and Redis namespace."""

import time
from datetime import UTC, datetime

from celery import current_app

from configs import dify_config
from services.knowledge_fs.background_contract import (
    DELIVERY_TASK,
    DOCUMENT_QUEUE,
    MAINTENANCE_QUEUE,
    BackgroundJobPayload,
)


def check_background_publisher_ready() -> None:
    if not dify_config.KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED:
        raise RuntimeError("KnowledgeFS Celery delivery is not enabled")
    transport_options = dict(current_app.conf.broker_transport_options or {})
    transport_options.update(socket_connect_timeout=3, socket_timeout=3)
    with current_app.connection_for_write(connect_timeout=3, transport_options=transport_options) as connection:
        connection.ensure_connection(max_retries=0, timeout=3)


def publish_background_job(job: BackgroundJobPayload) -> None:
    if not dify_config.KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED:
        raise RuntimeError("KnowledgeFS Celery delivery is not enabled")
    if job.runAfter is not None and job.runAfter > int(time.time() * 1000) + 86_400_000:
        raise ValueError("Background job delay exceeds the transport envelope")
    current_app.send_task(
        DELIVERY_TASK,
        kwargs={"delivery": job.model_dump(mode="json", exclude={"runAfter"})},
        task_id=str(job.id),
        queue=DOCUMENT_QUEUE if job.type == "document.compile" else MAINTENANCE_QUEUE,
        eta=datetime.fromtimestamp(job.runAfter / 1000, tz=UTC) if job.runAfter is not None else None,
        retry=False,
    )
