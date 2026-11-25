"""Celery beat entry points that delete expired file transfers, and stored bytes left without a transfer."""

import logging
import time
from datetime import timedelta
from typing import Final

from celery import shared_task

from extensions.ext_application_services import application_services

logger = logging.getLogger(__name__)

# A working size per round trip, not a limit: the task drains every expired transfer.
PURGE_BATCH: Final = 100
# Stored bytes deleted at once; storage calls wait on the network, so a few threads multiply the pace.
DELETE_WORKERS: Final = 8


@shared_task(queue="retention")
def clean_file_transfers_task() -> None:
    """Postcondition: no expired transfer is left; one log line says how many went and how overdue the most
    overdue one was, which shows whether the task keeps up."""
    transfers = application_services().file_transfers
    started = time.monotonic()
    removed = 0
    longest_overdue = timedelta(0)
    batch = PURGE_BATCH
    while batch == PURGE_BATCH:
        result = transfers.purge_expired(limit=PURGE_BATCH, workers=DELETE_WORKERS)
        batch = result.removed
        removed += result.removed
        longest_overdue = max(longest_overdue, result.longest_overdue)
    logger.info(
        "file transfer purge removed %d transfers; the most overdue had expired %d s before",
        removed,
        longest_overdue.total_seconds(),
        extra={
            "removed": removed,
            "longest_overdue_seconds": longest_overdue.total_seconds(),
            "duration_seconds": time.monotonic() - started,
        },
    )


@shared_task(queue="retention")
def sweep_file_transfers_task() -> None:
    """Postcondition: no stored transfer bytes are left without a row; one log line says how many went."""
    deleted = application_services().file_transfers.sweep_orphans(workers=DELETE_WORKERS)
    logger.info("file transfer sweep deleted %d stored files with no transfer", deleted, extra={"deleted": deleted})
