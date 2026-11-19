"""Retired entry point of the previous trace pipeline.

Producers from before an upgrade may still enqueue this task. Its payload uses
the previous record format, so the message is dropped and its payload deleted;
only old workers can export it. Keep new workers off the old queue until it has
drained. The new pipeline's sweeper leaves legacy payloads alone.
"""

import logging
import re

from celery import shared_task

from extensions.ext_storage import storage

logger = logging.getLogger(__name__)

_PAYLOAD_SEGMENT = re.compile(r"[A-Za-z0-9-]+")


@shared_task(queue="ops_trace")
def process_trace_tasks(file_info: dict[str, object]) -> None:
    app_id, file_id = file_info.get("app_id"), file_info.get("file_id")
    if isinstance(app_id, str) and isinstance(file_id, str):
        if _PAYLOAD_SEGMENT.fullmatch(app_id) and _PAYLOAD_SEGMENT.fullmatch(file_id):
            try:
                storage.delete(f"ops_trace/{app_id}/{file_id}.json")
            except Exception:
                logger.warning("Legacy trace payload cleanup failed: app_id=%s", app_id, exc_info=True)
    logger.info("Dropped a trace task enqueued before the trace pipeline upgrade: app_id=%s", app_id)
