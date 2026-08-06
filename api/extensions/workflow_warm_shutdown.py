"""Coordinate active workflow runs during planned process shutdown."""

import logging
import os
import threading
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any, cast

from celery.signals import worker_shutdown, worker_shutting_down
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.workflow import command_channels as workflow_command_channels
from core.app.apps.workflow.active_workflow_tasks import (
    ActiveWorkflowTask,
    get_active_workflow_task_count,
    get_active_workflow_tasks,
    reset_active_workflow_tasks,
    retain_active_workflow_tasks,
)
from libs.datetime_utils import naive_utc_now

logger = logging.getLogger(__name__)
WORKFLOW_WARM_SHUTDOWN_ABORT_REASON = workflow_command_channels.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON
WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON = workflow_command_channels.WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON
WORKFLOW_WARM_SHUTDOWN_TIMEOUT_REASON = "Workflow stopped because the worker drain deadline expired."
_WORKER_SHUTTING_DOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutting_down"
_WORKER_SHUTDOWN_DISPATCH_UID = "dify.workflow_warm_shutdown.shutdown"
_workflow_warm_shutdown_started = threading.Event()
# Keep the private alias temporarily because existing tests and out-of-tree
# extensions may still clear it between worker initializations.
_celery_warm_shutdown_started = _workflow_warm_shutdown_started
_workflow_drain_watchdog_started = threading.Event()
_workflow_drain_watchdog_lock = threading.Lock()


def _is_warm_shutdown(how: Any) -> bool:
    return str(how).strip().lower() == "warm"


def workflow_warm_shutdown_started() -> bool:
    """Return whether this process has started a planned warm shutdown."""
    return _workflow_warm_shutdown_started.is_set()


def celery_warm_shutdown_started() -> bool:
    """Backward-compatible alias for workflow command-channel callers."""
    return workflow_warm_shutdown_started()


def mark_workflow_warm_shutdown_started() -> None:
    """Mark this process as draining workflow executions."""
    _workflow_warm_shutdown_started.set()


def mark_celery_warm_shutdown_started() -> None:
    """Backward-compatible alias for Celery integrations."""
    mark_workflow_warm_shutdown_started()


def mark_workflow_runs_stopped_if_running_without_active_handoff(
    workflow_run_ids: Sequence[str],
    *,
    reason: str,
    now: datetime | None = None,
    session_maker: sessionmaker[Session] | None = None,
) -> int:
    """Conditionally stop runs that have no recoverable durable handoff.

    A durable READY/CLAIMED handoff is excluded because another worker can
    recover it. The RUNNING predicate preserves any terminal state already
    written by a user Stop or by normal workflow completion.
    """
    normalized_run_ids = sorted({workflow_run_id for workflow_run_id in workflow_run_ids if workflow_run_id})
    if not normalized_run_ids:
        return 0
    if not reason:
        raise ValueError("reason must not be empty")

    # Resolve the process-global session maker lazily. It is configured after
    # Celery initialization but before a worker can receive a shutdown signal,
    # and unlike ``db.engine`` it does not require a Flask app context here.
    from sqlalchemy import exists, select, update

    from graphon.enums import WorkflowExecutionStatus
    from models.workflow import WorkflowRun
    from models.workflow_handoff import WorkflowHandoffState, WorkflowRunHandoff

    active_handoff_exists = exists(
        select(WorkflowRunHandoff.id).where(
            WorkflowRunHandoff.workflow_run_id == WorkflowRun.id,
            WorkflowRunHandoff.state.in_((WorkflowHandoffState.READY, WorkflowHandoffState.CLAIMED)),
        )
    )
    statement = (
        update(WorkflowRun)
        .where(
            WorkflowRun.id.in_(normalized_run_ids),
            WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
            ~active_handoff_exists,
        )
        .values(
            status=WorkflowExecutionStatus.STOPPED,
            error=reason,
            finished_at=now or naive_utc_now(),
        )
    )

    if session_maker is None:
        from core.db.session_factory import session_factory

        session_maker = session_factory.get_session_maker()

    with session_maker.begin() as session:
        result = session.execute(statement)
        return max(cast(CursorResult, result).rowcount or 0, 0)


def _mark_timed_out_workflow_runs_stopped(
    registrations: Sequence[ActiveWorkflowTask],
    *,
    now: datetime | None = None,
    session_maker: sessionmaker[Session] | None = None,
) -> int:
    """Conditionally stop timed-out runs that still belong to this process."""
    active_registrations = retain_active_workflow_tasks(tuple(registrations))
    workflow_run_ids = [
        registration.workflow_run_id
        for registration in active_registrations
        if registration.workflow_run_id is not None
    ]
    return mark_workflow_runs_stopped_if_running_without_active_handoff(
        workflow_run_ids,
        reason=WORKFLOW_WARM_SHUTDOWN_TIMEOUT_REASON,
        now=now,
        session_maker=session_maker,
    )


def _wait_for_workflow_drain_deadline(timeout_seconds: float) -> None:
    threading.Event().wait(timeout_seconds)


def _run_workflow_drain_watchdog(
    *,
    timeout_seconds: float,
    fail_closed: Callable[[Sequence[ActiveWorkflowTask]], int] = _mark_timed_out_workflow_runs_stopped,
    hard_exit: Callable[[int], object] = os._exit,
    wait_for_deadline: Callable[[float], object] = _wait_for_workflow_drain_deadline,
) -> None:
    """Enforce the workflow drain deadline without depending on Graphon polls."""
    if timeout_seconds < 0:
        raise ValueError("timeout_seconds must be non-negative")

    # Do not return merely because the registry is empty immediately after the
    # signal. An already-admitted API request can still be between request
    # dispatch and workflow registration. Keeping the deadline alive closes
    # that race; a naturally exiting process discards this daemon thread.
    wait_for_deadline(timeout_seconds)
    registrations = get_active_workflow_tasks()
    if not registrations:
        logger.info("All tracked workflow runs ended before the worker drain deadline")
        return

    try:
        stopped_count = fail_closed(registrations)
        logger.error(
            "Workflow worker drain deadline expired with %s active run(s); marked %s RUNNING run(s) STOPPED",
            len(registrations),
            stopped_count,
        )
    except Exception:
        # A failed status write must not turn the deadline into an unbounded
        # Celery shutdown. The process exits non-zero so orchestration can
        # surface and replace the unhealthy worker.
        logger.exception("Failed to mark workflow runs STOPPED after the worker drain deadline; forcing worker exit")
    finally:
        hard_exit(1)


def _start_workflow_drain_watchdog() -> None:
    """Start at most one process-local drain deadline watchdog."""
    # Gunicorn's gevent worker invokes Python signal handlers from the hub
    # callback.  Once ``threading`` is monkey-patched, ``Thread.start()`` waits
    # on a gevent Event and therefore cannot be called from that callback
    # (gevent raises ``BlockingSwitchOutError``).  Keep the shutdown flag and
    # active-run inspection synchronous, but defer only the watchdog launch to
    # a normal greenlet where starting the patched thread is safe.  Celery
    # workers without gevent monkey-patching continue down the native path.
    try:
        import gevent
        from gevent import monkey as gevent_monkey

        if gevent_monkey.is_module_patched("threading") and gevent.getcurrent() is gevent.get_hub():
            gevent.spawn(_start_workflow_drain_watchdog)
            return
    except ImportError:
        # gevent is optional for non-Gunicorn process roles.
        pass

    with _workflow_drain_watchdog_lock:
        if _workflow_drain_watchdog_started.is_set():
            return
        _workflow_drain_watchdog_started.set()
        watchdog = threading.Thread(
            target=_run_workflow_drain_watchdog,
            kwargs={"timeout_seconds": dify_config.WORKFLOW_HANDOFF_DRAIN_TIMEOUT_SECONDS},
            name="WorkflowDrainDeadline",
            daemon=True,
        )
        watchdog.start()


def begin_workflow_warm_shutdown(*, source: str = "process") -> None:
    """Start process-wide workflow draining for Celery or API workers.

    The shutdown state is set before inspecting the registry so execution
    command channels created concurrently observe it. When durable handoff is
    enabled, the deadline watchdog starts even if the registry is momentarily
    empty, covering already-admitted API requests that register slightly later.
    """
    if not source:
        raise ValueError("source must not be empty")

    mark_workflow_warm_shutdown_started()
    active_count = get_active_workflow_task_count()
    if active_count:
        logger.info("Marked %s warm shutdown for %s active workflow run(s)", source, active_count)
    else:
        logger.info("No active workflow runs found when %s warm shutdown started", source)

    if dify_config.WORKFLOW_HANDOFF_ENABLED:
        _start_workflow_drain_watchdog()


def _on_worker_shutting_down(*args: object, **kwargs: object) -> None:
    """Mark warm shutdown and log the active workflow run count."""
    how = kwargs.get("how")
    if not _is_warm_shutdown(how):
        logger.debug("Skip workflow handoff during non-warm Celery shutdown: how=%s", how)
        return

    begin_workflow_warm_shutdown(source="Celery worker")


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
    """Connect Celery worker shutdown handlers for workflow drain and logging."""
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
