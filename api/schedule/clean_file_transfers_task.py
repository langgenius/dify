"""Celery beat entry point that deletes expired file transfers and their stored bytes."""

from typing import Final

from celery import shared_task

from extensions.ext_application_services import application_services

# A working size per round trip, not a limit: the task drains every expired transfer.
PURGE_BATCH: Final = 100


@shared_task(queue="retention")
def clean_file_transfers_task() -> None:
    transfers = application_services().file_transfers
    removed = PURGE_BATCH
    while removed == PURGE_BATCH:
        removed = transfers.purge_expired(limit=PURGE_BATCH)
