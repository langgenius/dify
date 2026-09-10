"""Abort active workflow runs during Celery warm shutdown."""

import logging
import threading
from typing import Any

from celery.signals import worker_shutdown, worker_shutting_down

from core.app.apps.workflow.active_workflow_tasks import (
    get_active_workflow_task_count,
    reset_active_workflow_tasks,
)

logger = logging.getLogger(__name__)
WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."
_WORKER_SHUTTING_DOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutting_down"
_WORKER_SHUTDOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutdown"
_celery_warm_shutdown_started = threading.Event()


def _is_warm_shutdown(how: Any) -> bool:
    return str(how).strip().lower() == "warm"


def celery_warm_shutdown_started() -> bool:
    """Return whether the current worker process started Celery warm shutdown."""
    return _celery_warm_shutdown_started.is_set()


def mark_celery_warm_shutdown_started() -> None:
    """Mark the current worker process as being in Celery warm shutdown."""
    _celery_warm_shutdown_started.set()


def _on_worker_shutting_down(*args: object, **kwargs: object) -> None:
    """Mark warm shutdown and log the active workflow run count."""
    how = kwargs.get("how")
    if not _is_warm_shutdown(how):
        logger.debug("Skip workflow abort during non-warm Celery shutdown: how=%s", how)
        return

    mark_celery_warm_shutdown_started()
    abort_count = get_active_workflow_task_count()
    if abort_count == 0:
        logger.info("No active workflow runs found during Celery warm shutdown")
        return

    logger.info(
        "Marked Celery warm shutdown for %s active workflow run(s)",
        abort_count,
    )


def _on_worker_shutdown(*args: object, **kwargs: object) -> None:
    """Log whether tracked workflow tasks ended before Celery worker shutdown."""
    remaining_run_count = get_active_workflow_task_count()
    if remaining_run_count:
        logger.warning(
            "Celery worker is shutting down with %s workflow run(s) still active after warm shutdown wait",
            remaining_run_count,
        )
        return

    logger.info("Celery worker shutdown reached after all tracked workflow runs ended")


def setup_workflow_warm_shutdown_handler() -> None:
    """Connect Celery worker shutdown handlers for workflow abort and logging."""
    reset_active_workflow_tasks()
    worker_shutting_down.connect(
        _on_worker_shutting_down,
        weak=False,
        dispatch_uid=_WORKER_SHUTTING_DOWN_DISPATCH_UID,
    )
    worker_shutdown.connect(
        _on_worker_shutdown,
        weak=False,
        dispatch_uid=_WORKER_SHUTDOWN_DISPATCH_UID,
    )
