"""Abort active workflow runs during Celery warm shutdown."""

import logging
from typing import Any

from celery.signals import worker_shutdown, worker_shutting_down

from core.app.apps.workflow.command_channels import (
    get_celery_signal_command_channel_count,
    send_celery_warm_shutdown_abort_commands,
)

logger = logging.getLogger(__name__)
_WORKER_SHUTTING_DOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutting_down"
_WORKER_SHUTDOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutdown"


def _is_warm_shutdown(how: Any) -> bool:
    return str(how).strip().lower() == "warm"


def _on_worker_shutting_down(*args: object, **kwargs: object) -> None:
    """Send abort commands for active workflow tasks before Celery exits."""
    how = kwargs.get("how")
    if not _is_warm_shutdown(how):
        logger.debug("Skip workflow abort during non-warm Celery shutdown: how=%s", how)
        return

    abort_count = send_celery_warm_shutdown_abort_commands()
    if abort_count == 0:
        logger.info("No active workflow command channels found during Celery warm shutdown")
        return

    logger.info(
        "Pushed workflow abort commands to %s local command channel(s) during Celery warm shutdown",
        abort_count,
    )


def _on_worker_shutdown(*args: object, **kwargs: object) -> None:
    """Log whether tracked workflow tasks ended before Celery worker shutdown."""
    remaining_channel_count = get_celery_signal_command_channel_count()
    if remaining_channel_count:
        logger.warning(
            "Celery worker is shutting down with %s workflow command channel(s) still active after warm shutdown wait",
            remaining_channel_count,
        )
        return

    logger.info("Celery worker shutdown reached after all tracked workflow command channels ended")


def setup_workflow_warm_shutdown_handler() -> None:
    """Connect Celery worker shutdown handlers for workflow abort and logging."""
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
