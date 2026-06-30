"""Abort active workflow runs during Celery warm shutdown."""

import logging
from typing import Any

from celery.signals import worker_shutting_down

from core.app.apps.workflow.active_workflow_tasks import get_active_workflow_task_ids
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager

logger = logging.getLogger(__name__)
_SIGNAL_DISPATCH_UID = "dify.workflow_warm_shutdown"


def _is_warm_shutdown(how: Any) -> bool:
    return str(how).strip().lower() == "warm"


def _on_worker_shutting_down(*args: object, **kwargs: object) -> None:
    """Send abort commands for active workflow tasks before Celery exits."""
    how = kwargs.get("how")
    if not _is_warm_shutdown(how):
        logger.debug("Skip workflow abort during non-warm Celery shutdown: how=%s", how)
        return

    task_ids = get_active_workflow_task_ids()
    if not task_ids:
        logger.info("No active workflow tasks found during Celery warm shutdown")
        return

    manager = GraphEngineManager(redis_client)
    logger.info("Aborting %s active workflow task(s) during Celery warm shutdown", len(task_ids))
    for task_id in task_ids:
        try:
            manager.send_stop_command(task_id)
        except Exception:
            logger.exception("Failed to send workflow stop command during warm shutdown, task_id=%s", task_id)


def setup_workflow_warm_shutdown_handler() -> None:
    """Connect the Celery warm-shutdown workflow abort handler."""
    worker_shutting_down.connect(_on_worker_shutting_down, weak=False, dispatch_uid=_SIGNAL_DISPATCH_UID)
