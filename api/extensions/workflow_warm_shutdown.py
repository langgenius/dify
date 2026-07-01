"""Abort active workflow runs during Celery warm shutdown."""

import _thread
import logging
from typing import Any

from celery.signals import worker_shutdown, worker_shutting_down

from core.app.apps.workflow.active_workflow_tasks import get_active_workflow_task_ids
from extensions.ext_redis import create_redis_client
from graphon.graph_engine.manager import GraphEngineManager

logger = logging.getLogger(__name__)
_WORKER_SHUTTING_DOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutting_down"
_WORKER_SHUTDOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutdown"
WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = "Workflow stopped because the worker is shutting down."


def _start_native_thread(function: Any, args: tuple[object, ...]) -> int:
    try:
        from gevent import monkey

        start_new_thread = monkey.get_original("_thread", "start_new_thread")
        if callable(start_new_thread):
            return start_new_thread(function, args)
    except Exception:
        logger.debug("Failed to resolve original _thread.start_new_thread; falling back to current one", exc_info=True)

    return _thread.start_new_thread(function, args)


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

    logger.info("Aborting %s active workflow task(s) during Celery warm shutdown", len(task_ids))
    _send_stop_commands(task_ids)


def _send_stop_commands(task_ids: tuple[str, ...]) -> None:
    def send() -> None:
        try:
            local_redis_client = create_redis_client()
        except Exception:
            logger.exception("Failed to create Redis client for workflow stop commands during warm shutdown")
            return

        try:
            manager = GraphEngineManager(local_redis_client)
            for task_id in task_ids:
                try:
                    manager.send_stop_command(
                        task_id,
                        reason=WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
                    )
                except Exception:
                    logger.exception("Failed to send workflow stop command during warm shutdown, task_id=%s", task_id)
        finally:
            local_redis_client.close()

    try:
        # Celery's gevent shutdown signal can run inside an event-loop callback.
        # threading.Thread.start() waits for thread startup and may switch through gevent there.
        _start_native_thread(send, ())
    except Exception:
        logger.exception("Failed to start workflow stop command sender during warm shutdown")


def _on_worker_shutdown(*args: object, **kwargs: object) -> None:
    """Log whether tracked workflow tasks ended before Celery worker shutdown."""
    remaining_task_ids = get_active_workflow_task_ids()
    if remaining_task_ids:
        logger.warning(
            "Celery worker is shutting down with %s workflow task(s) still active after warm shutdown wait",
            len(remaining_task_ids),
        )
        return

    logger.info("Celery worker shutdown reached after all tracked workflow tasks ended")


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
