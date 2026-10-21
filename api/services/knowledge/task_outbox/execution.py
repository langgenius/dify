"""Completion and recovery of durable knowledge task deliveries."""

import logging
import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import NoReturn, Self

from libs.datetime_utils import naive_utc_now
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionDeferredError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskFailureDisposition,
    KnowledgeTaskPermanentError,
    KnowledgeTaskRequeuedError,
    KnowledgeTaskRetriesExhaustedError,
    KnowledgeTaskStore,
)

logger = logging.getLogger(__name__)

_EXECUTION_RETRY_DELAY = timedelta(seconds=5)
EXECUTION_LEASE_SECONDS = 300


class KnowledgeTaskExecutionLease:
    """Ownership of one durable delivery; legacy deliveries use a no-op lease."""

    def __init__(
        self,
        *,
        intent_id: str | None,
        execution_id: str | None,
        store: KnowledgeTaskStore | None,
        clock: Callable[[], datetime],
        lease_seconds: int,
        assert_admitted: Callable[[], None] | None,
        recovered_execution: bool,
    ) -> None:
        self._intent_id = intent_id
        self._execution_id = execution_id
        self._store = store
        self._clock = clock
        self._lease_seconds = lease_seconds
        self._assert_admitted = assert_admitted
        self._recovered_execution = recovered_execution
        self._lost = threading.Event()

    @classmethod
    def untracked(cls, *, assert_admitted: Callable[[], None] | None = None) -> Self:
        """Keep direct pre-outbox deliveries usable without acquiring a database lease."""
        return cls(
            intent_id=None,
            execution_id=None,
            store=None,
            clock=naive_utc_now,
            lease_seconds=EXECUTION_LEASE_SECONDS,
            assert_admitted=assert_admitted,
            recovered_execution=False,
        )

    @property
    def recovered_execution(self) -> bool:
        """Whether this claim took over an execution whose durable lease expired."""

        return self._recovered_execution

    @property
    def intent_id(self) -> str | None:
        """Durable intent guarded by this lease, absent for legacy deliveries."""

        return self._intent_id

    @property
    def execution_id(self) -> str | None:
        """Current durable execution claim, absent for legacy deliveries."""

        return self._execution_id

    def defer(self, *, error: str, delay_seconds: int) -> NoReturn:
        """Return this execution to pending without consuming an execution attempt."""

        if delay_seconds <= 0:
            raise ValueError("Knowledge task execution deferral delay must be positive")
        if self._intent_id is None or self._execution_id is None or self._store is None:
            raise ValueError("An untracked knowledge task execution cannot be deferred")
        deferred = self._store.defer_task_execution(
            intent_id=self._intent_id,
            execution_id=self._execution_id,
            available_at=self._clock() + timedelta(seconds=delay_seconds),
            error=error,
        )
        if not deferred:
            self._lost.set()
            raise KnowledgeTaskExecutionLeaseLostError(
                f"Knowledge task execution lease was lost while deferring: {self._intent_id}"
            )
        raise KnowledgeTaskExecutionDeferredError(f"Knowledge task execution {self._intent_id} was durably deferred")

    def renew(self) -> bool:
        if self._lost.is_set():
            return False
        try:
            if self._assert_admitted is not None:
                self._assert_admitted()
            if self._intent_id is None:
                return True
            assert self._execution_id is not None
            assert self._store is not None
            now = self._clock()
            owned = self._store.renew_task_execution(
                intent_id=self._intent_id,
                execution_id=self._execution_id,
                now=now,
                lease_until=now + timedelta(seconds=self._lease_seconds),
            )
        except Exception:
            logger.exception("Failed to renew knowledge task execution %s", self._intent_id)
            owned = False
        if not owned:
            self._lost.set()
        return owned

    def assert_owned(self) -> None:
        if not self.renew():
            raise KnowledgeTaskExecutionLeaseLostError(f"Knowledge task execution lease was lost: {self._intent_id}")

    def keep_alive(self, stopped: threading.Event, interval: float) -> None:
        while not stopped.wait(interval):
            if not self.renew():
                return


@contextmanager
def knowledge_task_execution(
    outbox_id: str | None,
    *,
    store: KnowledgeTaskStore,
    clock: Callable[[], datetime] = naive_utc_now,
    wake: Callable[[], bool],
    lease_seconds: int = EXECUTION_LEASE_SECONDS,
    heartbeat_interval: float = 30,
    assert_admitted: Callable[[], None] | None = None,
) -> Generator[KnowledgeTaskExecutionLease | None]:
    """Record execution completion or durably requeue its failure.

    Calls without an outbox id keep direct task invocation compatible. When an
    outbox-backed task fails, durable state is written before Celery
    acknowledges the delivery. Database bookkeeping failures deliberately
    propagate the original execution error so the task's existing autoretry is a
    fallback.
    """

    if lease_seconds <= 0 or heartbeat_interval <= 0 or heartbeat_interval >= lease_seconds:
        raise ValueError("Execution heartbeat must be positive and shorter than its lease")
    if outbox_id is None:
        yield KnowledgeTaskExecutionLease.untracked(assert_admitted=assert_admitted)
        return

    now = clock()
    execution_id = store.begin_task_execution(
        intent_id=outbox_id, now=now, lease_until=now + timedelta(seconds=lease_seconds)
    )
    if execution_id is None:
        yield None
        return
    recovered_execution = store.is_recovered_task_execution(
        intent_id=outbox_id,
        execution_id=execution_id,
    )

    lease = KnowledgeTaskExecutionLease(
        intent_id=outbox_id,
        execution_id=execution_id,
        store=store,
        clock=clock,
        lease_seconds=lease_seconds,
        assert_admitted=assert_admitted,
        recovered_execution=recovered_execution,
    )
    stopped = threading.Event()
    heartbeat = threading.Thread(
        target=lease.keep_alive,
        args=(stopped, heartbeat_interval),
        name=f"KnowledgeTaskExecution({outbox_id})",
        daemon=True,
    )
    heartbeat.start()
    try:
        yield lease
        lease.assert_owned()
    except KnowledgeTaskExecutionDeferredError:
        try:
            woke_dispatcher = wake()
        except Exception:
            logger.exception("Failed to wake dispatcher for deferred knowledge task intent %s", outbox_id)
        else:
            if not woke_dispatcher:
                logger.warning("Dispatcher wake failed for deferred knowledge task intent %s", outbox_id)
        raise
    except KnowledgeTaskExecutionLeaseLostError:
        raise
    except KnowledgeTaskPermanentError as execution_error:
        lease.assert_owned()
        if not store.mark_task_failed(
            intent_id=outbox_id, execution_id=execution_id, error=str(execution_error)[:4000]
        ):
            raise RuntimeError(f"knowledge task intent {outbox_id} could not be marked failed") from execution_error
        raise
    except Exception as execution_error:
        lease.assert_owned()
        try:
            disposition = store.requeue_task_failure(
                intent_id=outbox_id,
                execution_id=execution_id,
                available_at=clock() + _EXECUTION_RETRY_DELAY,
                error=str(execution_error)[:4000],
            )
        except Exception as persistence_error:
            logger.exception("Failed to persist execution retry for knowledge task intent %s", outbox_id)
            raise execution_error from persistence_error

        if disposition == KnowledgeTaskFailureDisposition.MISSING:
            logger.exception("Knowledge task intent could not be requeued: %s", outbox_id)
            raise KnowledgeTaskExecutionLeaseLostError(
                f"Knowledge task {outbox_id} lost its execution claim"
            ) from execution_error

        if disposition == KnowledgeTaskFailureDisposition.FAILED:
            raise KnowledgeTaskRetriesExhaustedError(
                f"knowledge task intent {outbox_id} exhausted its execution retry budget"
            ) from execution_error

        if disposition == KnowledgeTaskFailureDisposition.REQUEUED:
            try:
                woke_dispatcher = wake()
            except Exception:
                logger.exception("Failed to wake dispatcher for requeued knowledge task intent %s", outbox_id)
            else:
                if not woke_dispatcher:
                    logger.warning("Dispatcher wake failed for requeued knowledge task intent %s", outbox_id)
            message = f"knowledge task intent {outbox_id} was durably requeued"
        else:
            message = f"knowledge task intent {outbox_id} was already completed by another delivery"
        raise KnowledgeTaskRequeuedError(message) from execution_error
    else:
        if not store.mark_task_completed(intent_id=outbox_id, execution_id=execution_id):
            raise RuntimeError(f"knowledge task intent {outbox_id} could not be marked completed")
    finally:
        stopped.set()
        heartbeat.join(timeout=min(5, heartbeat_interval))
