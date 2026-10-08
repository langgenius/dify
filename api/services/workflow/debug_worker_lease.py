"""Keep trigger-debug resources owned while a worker is executing, including silent nodes."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from threading import Event, Thread
from time import monotonic

from configs import dify_config
from libs.datetime_utils import naive_utc_now
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from services.errors.workflow_service import WorkflowDebugReservationExpiredError
from services.workflow.debug_cancellation import DebugExecutionCancellation

logger = logging.getLogger(__name__)


@contextmanager
def keep_debug_worker_alive(
    reservations: WorkflowDebugReservationRepository,
    *,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    execution_id: str,
) -> Generator[DebugExecutionCancellation, None, None]:
    def renew() -> bool:
        return reservations.renew(
            tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, execution_id=execution_id, now=naive_utc_now()
        )

    # Fail before engine work if this worker resumed scheduling after its lease
    # was recovered. The caller only opens this scope for reserved debug runs.
    timeout = dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT
    started = monotonic()
    if not renew():
        raise WorkflowDebugReservationExpiredError("Trigger debug worker lease expired")
    cancellation = DebugExecutionCancellation(deadline=started + timeout)
    cancellation.raise_if_cancelled()

    stopped = Event()
    interval = min(30.0, dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT / 3)

    def heartbeat() -> None:
        while not stopped.wait(interval):
            if cancellation.is_cancelled():
                return
            try:
                started = monotonic()
                if not renew():
                    cancellation.cancel()
                    return
                cancellation.renew_until(started + timeout)
            except Exception:
                logger.exception("Failed to renew debug worker lease %s", execution_id)
                if cancellation.is_cancelled():
                    return

    def watch_deadline() -> None:
        # Renewal may block on the database. Expiry must still abort an active
        # node without waiting for that call or the next ready-queue operation.
        while (remaining := cancellation.seconds_until_expiry()) is not None:
            if stopped.wait(remaining) or cancellation.is_cancelled():
                return

    worker = Thread(target=heartbeat, name=f"debug-lease-{execution_id}", daemon=True)
    watchdog = Thread(target=watch_deadline, name=f"debug-deadline-{execution_id}", daemon=True)
    worker.start()
    watchdog.start()
    try:
        yield cancellation
    finally:
        stopped.set()
        worker.join(timeout=1)
        watchdog.join(timeout=1)
    cancellation.raise_if_cancelled()
