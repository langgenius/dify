"""Abort active workflow runs during Celery warm shutdown."""

import logging
from typing import Any

from celery.signals import worker_shutdown, worker_shutting_down

from core.app.apps.workflow.active_workflow_tasks import (
    get_active_workflow_task_count,
    reset_active_workflow_tasks,
)
from core.app.apps.workflow.command_channels import (
    reset_abort_command,
    set_abort_command,
)
from graphon.graph_engine.entities.commands import AbortCommand

logger = logging.getLogger(__name__)
WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."
_WORKER_SHUTTING_DOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutting_down"
_WORKER_SHUTDOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutdown"


def _is_warm_shutdown(how: Any) -> bool:
    return str(how).strip().lower() == "warm"


def set_celery_warm_shutdown_abort_command(
    *,
    reason: str = WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
) -> None:
    """Set the process-wide abort command."""
    set_abort_command(AbortCommand(reason=reason))


def reset_celery_warm_shutdown_state() -> None:
    """Reset local Celery warm shutdown abort state for worker initialization and tests."""
    reset_abort_command()


def _on_worker_shutting_down(*args: object, **kwargs: object) -> None:
    """Set the warm-shutdown abort command and log the active workflow run count."""
    how = kwargs.get("how")
    if not _is_warm_shutdown(how):
        logger.debug("Skip workflow abort during non-warm Celery shutdown: how=%s", how)
        return

    set_celery_warm_shutdown_abort_command()
    abort_count = get_active_workflow_task_count()
    if abort_count == 0:
        logger.info("No active workflow runs found during Celery warm shutdown")
        return

    logger.info(
        "Set workflow warm shutdown abort command for %s active workflow run(s)",
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
    reset_celery_warm_shutdown_state()
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
