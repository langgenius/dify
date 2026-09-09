"""Retry cached failed-import cleanup, including previous worker outages."""

import logging

from celery import shared_task

from services.agent.roster_package_cleanup import RosterPackageCleanup

logger = logging.getLogger(__name__)


@shared_task(queue="retention")
def cleanup_roster_packages() -> None:
    cleanup = RosterPackageCleanup()
    for key in cleanup.cache.due():
        job = cleanup.cache.load(key)
        if job is None:
            cleanup.cache.complete(key)
            continue
        try:
            # Move failures behind other pending jobs to avoid starvation.
            cleanup.cache.save(job)
            cleanup.run(key)
        except Exception:
            logger.exception("Roster Agent package cleanup failed; retained for retry: key=%s", key)
