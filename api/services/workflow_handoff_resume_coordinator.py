import logging
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from threading import Event, Thread
from types import TracebackType
from typing import Protocol, override

from libs.datetime_utils import naive_utc_now
from models.workflow_handoff import (
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.workflow_handoff_repository import WorkflowRunHandoffRepository
from services.workflow_handoff_service import (
    UnsupportedWorkflowHandoffSnapshotVersionError,
    WorkflowHandoffService,
    WorkflowHandoffSnapshotIntegrityError,
)

logger = logging.getLogger(__name__)


class PermanentWorkflowHandoffResumeError(RuntimeError):
    """A checkpoint cannot become resumable without operator intervention."""


class UnsupportedWorkflowHandoffResumeRouteError(PermanentWorkflowHandoffResumeError):
    pass


@dataclass(frozen=True)
class WorkflowHandoffLease:
    """Fenced lease handle available to route-specific resume setup."""

    repository: WorkflowRunHandoffRepository
    handoff_id: str
    generation: int
    lease_owner: str
    lease_token: str
    lease_duration: timedelta

    def renew(self, *, now: datetime) -> bool:
        return self.repository.renew_lease(
            handoff_id=self.handoff_id,
            generation=self.generation,
            lease_owner=self.lease_owner,
            lease_token=self.lease_token,
            lease_duration=self.lease_duration,
            now=now,
        )


class _WorkflowHandoffLeaseHeartbeat(AbstractContextManager[None]):
    """Keep a claimed checkpoint fenced while route setup reaches graph ACK.

    A resume handler may spend longer than one lease loading plugins or building
    a large graph.  The acknowledgement layer stops accepting renewals once the
    row becomes RESUMED, so this daemon naturally exits after graph acceptance.
    """

    def __init__(
        self,
        *,
        lease: WorkflowHandoffLease,
        clock: Callable[[], datetime],
        interval: timedelta,
    ) -> None:
        if interval.total_seconds() <= 0:
            raise ValueError("heartbeat interval must be positive")
        self._lease = lease
        self._clock = clock
        self._interval_seconds = interval.total_seconds()
        self._stopped = Event()
        self._thread = Thread(
            target=self._renew_until_stopped,
            name=f"workflow-handoff-lease-{lease.handoff_id}",
            daemon=True,
        )

    @override
    def __enter__(self) -> None:
        self._thread.start()

    @override
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._stopped.set()
        self._thread.join()

    def _renew_until_stopped(self) -> None:
        while not self._stopped.wait(self._interval_seconds):
            try:
                if not self._lease.renew(now=self._clock()):
                    return
            except Exception:
                # A transient database failure must not crash the process. The
                # next heartbeat can recover before expiry; the fenced ACK still
                # prevents this worker from accepting a lease it ultimately lost.
                logger.exception(
                    "Failed to renew workflow handoff lease: handoff_id=%s, generation=%s",
                    self._lease.handoff_id,
                    self._lease.generation,
                )


@dataclass(frozen=True)
class WorkflowHandoffResumeRequest:
    """Verified checkpoint and claim identity passed to a business resumer."""

    handoff: WorkflowRunHandoff
    serialized_state: bytes
    lease: WorkflowHandoffLease


class WorkflowHandoffResumeDispatcher(Protocol):
    """Route a claimed checkpoint to Workflow, Chatflow, Trigger, or RAG resume code.

    The handler must install ``WorkflowHandoffResumeAcknowledgementLayer`` and
    call its explicit check on the resumption start event. Returning before the
    handoff reaches ``RESUMED`` is treated as a retryable setup failure.
    """

    def dispatch(self, request: WorkflowHandoffResumeRequest) -> None: ...


type WorkflowHandoffResumeHandler = Callable[[WorkflowHandoffResumeRequest], None]


class MappingWorkflowHandoffResumeDispatcher:
    """Small dependency-injection adapter for route-specific callback functions."""

    def __init__(self, handlers: Mapping[WorkflowHandoffResumeRoute, WorkflowHandoffResumeHandler]):
        self._handlers = dict(handlers)

    def dispatch(self, request: WorkflowHandoffResumeRequest) -> None:
        handler = self._handlers.get(request.handoff.resume_route)
        if handler is None:
            raise UnsupportedWorkflowHandoffResumeRouteError(
                f"No workflow handoff resume handler for route: {request.handoff.resume_route}"
            )
        handler(request)


class WorkflowHandoffResumeOutcome(StrEnum):
    CLAIM_NOT_ACQUIRED = "claim_not_acquired"
    RESUMED = "resumed"
    RETRY_SCHEDULED = "retry_scheduled"
    FAILED = "failed"
    LEASE_LOST = "lease_lost"


@dataclass(frozen=True)
class WorkflowHandoffResumeResult:
    outcome: WorkflowHandoffResumeOutcome
    handoff_id: str
    generation: int
    error: str | None = None


class WorkflowHandoffResumeCoordinator:
    """Claim, verify, and dispatch one idempotent workflow handoff message.

    Celery delivery is at-least-once. ``claim`` provides the exclusive fence;
    only that claim's lease token may acknowledge or release the generation.
    Retry state is persisted in the outbox row rather than delegated to Celery,
    so a periodic scan recovers broker loss and worker interruption uniformly.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        handoff_service: WorkflowHandoffService,
        lease_duration: timedelta,
        retry_delay: timedelta,
        max_attempts: int,
        clock: Callable[[], datetime] = naive_utc_now,
        lease_heartbeat_factory: Callable[[WorkflowHandoffLease], AbstractContextManager[None]] | None = None,
    ) -> None:
        if lease_duration.total_seconds() <= 0:
            raise ValueError("lease_duration must be positive")
        if retry_delay.total_seconds() < 0:
            raise ValueError("retry_delay must be non-negative")
        if max_attempts <= 0:
            raise ValueError("max_attempts must be positive")
        self._repository = repository
        self._handoff_service = handoff_service
        self._lease_duration = lease_duration
        self._retry_delay = retry_delay
        self._max_attempts = max_attempts
        self._clock = clock
        heartbeat_interval = timedelta(seconds=max(1.0, lease_duration.total_seconds() / 3))
        self._lease_heartbeat_factory = lease_heartbeat_factory or (
            lambda lease: _WorkflowHandoffLeaseHeartbeat(
                lease=lease,
                clock=self._clock,
                interval=heartbeat_interval,
            )
        )

    def resume(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        now: datetime,
        dispatcher: WorkflowHandoffResumeDispatcher,
    ) -> WorkflowHandoffResumeResult:
        claimed = self._repository.claim(
            handoff_id=handoff_id,
            generation=generation,
            lease_owner=lease_owner,
            lease_duration=self._lease_duration,
            max_attempts=self._max_attempts,
            now=now,
        )
        if claimed is None:
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.CLAIM_NOT_ACQUIRED,
                handoff_id=handoff_id,
                generation=generation,
            )

        lease = self._lease_from_claim(claimed)
        try:
            serialized_state = self._handoff_service.load_and_verify_state(claimed)
        except (UnsupportedWorkflowHandoffSnapshotVersionError, WorkflowHandoffSnapshotIntegrityError) as error:
            return self._fail_permanently(claimed=claimed, error=error, now=self._clock())
        except Exception as error:
            logger.exception("Failed to load workflow handoff checkpoint: handoff_id=%s", claimed.id)
            return self._schedule_retry(claimed=claimed, error=error, now=self._clock())

        # Loading from remote object storage can consume a meaningful portion of
        # a short lease. Refresh it once before route-specific setup. The handler
        # also receives this fenced lease handle if additional setup is lengthy.
        if not lease.renew(now=self._clock()):
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.LEASE_LOST,
                handoff_id=claimed.id,
                generation=claimed.generation,
                error="workflow handoff lease was lost before dispatch",
            )

        request = WorkflowHandoffResumeRequest(
            handoff=claimed,
            serialized_state=serialized_state,
            lease=lease,
        )
        try:
            with self._lease_heartbeat_factory(lease):
                dispatcher.dispatch(request)
        except PermanentWorkflowHandoffResumeError as error:
            return self._fail_permanently(claimed=claimed, error=error, now=self._clock())
        except Exception as error:
            logger.exception(
                "Workflow handoff resume handler failed: handoff_id=%s, route=%s",
                claimed.id,
                claimed.resume_route,
            )
            current = self._repository.get(claimed.id, claimed.generation)
            if current is not None and current.state == WorkflowHandoffState.RESUMED:
                # The graph already accepted the checkpoint. Retrying the handoff
                # would duplicate execution; ordinary workflow failure handling
                # now owns this runtime error.
                return WorkflowHandoffResumeResult(
                    outcome=WorkflowHandoffResumeOutcome.RESUMED,
                    handoff_id=claimed.id,
                    generation=claimed.generation,
                    error=self._error_text(error),
                )
            if current is not None and current.state == WorkflowHandoffState.FAILED:
                # The post-ACK stream drain reconciles the run and route-owned
                # records before raising. Report that durable terminal outcome
                # directly; retrying the released claim would be both stale and
                # capable of duplicating resumed node execution.
                return WorkflowHandoffResumeResult(
                    outcome=WorkflowHandoffResumeOutcome.FAILED,
                    handoff_id=claimed.id,
                    generation=claimed.generation,
                    error=current.last_error or self._error_text(error),
                )
            return self._schedule_retry(claimed=claimed, error=error, now=self._clock())

        current = self._repository.get(claimed.id, claimed.generation)
        if current is None:
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.LEASE_LOST,
                handoff_id=claimed.id,
                generation=claimed.generation,
                error="workflow handoff disappeared after dispatch",
            )
        if current.state == WorkflowHandoffState.RESUMED:
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.RESUMED,
                handoff_id=claimed.id,
                generation=claimed.generation,
            )
        if current.state == WorkflowHandoffState.FAILED:
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.FAILED,
                handoff_id=claimed.id,
                generation=claimed.generation,
                error=current.last_error,
            )
        return self._schedule_retry(
            claimed=claimed,
            error=RuntimeError("workflow handoff handler returned before acknowledgement"),
            now=self._clock(),
        )

    def _lease_from_claim(self, claimed: WorkflowRunHandoff) -> WorkflowHandoffLease:
        if not claimed.lease_owner or not claimed.lease_token:
            raise RuntimeError(f"Claimed workflow handoff has incomplete lease identity: {claimed.id}")
        return WorkflowHandoffLease(
            repository=self._repository,
            handoff_id=claimed.id,
            generation=claimed.generation,
            lease_owner=claimed.lease_owner,
            lease_token=claimed.lease_token,
            lease_duration=self._lease_duration,
        )

    def _schedule_retry(
        self,
        *,
        claimed: WorkflowRunHandoff,
        error: Exception,
        now: datetime,
    ) -> WorkflowHandoffResumeResult:
        if not claimed.lease_owner or not claimed.lease_token:
            return WorkflowHandoffResumeResult(
                outcome=WorkflowHandoffResumeOutcome.LEASE_LOST,
                handoff_id=claimed.id,
                generation=claimed.generation,
                error=self._error_text(error),
            )
        updated = self._repository.record_failure(
            handoff_id=claimed.id,
            generation=claimed.generation,
            lease_owner=claimed.lease_owner,
            lease_token=claimed.lease_token,
            error=self._error_text(error),
            retry_at=now + self._retry_delay,
            max_attempts=self._max_attempts,
            now=now,
        )
        if updated is None:
            outcome = WorkflowHandoffResumeOutcome.LEASE_LOST
        elif updated.state == WorkflowHandoffState.FAILED:
            outcome = WorkflowHandoffResumeOutcome.FAILED
        else:
            outcome = WorkflowHandoffResumeOutcome.RETRY_SCHEDULED
        return WorkflowHandoffResumeResult(
            outcome=outcome,
            handoff_id=claimed.id,
            generation=claimed.generation,
            error=self._error_text(error),
        )

    def _fail_permanently(
        self,
        *,
        claimed: WorkflowRunHandoff,
        error: Exception,
        now: datetime,
    ) -> WorkflowHandoffResumeResult:
        marked = self._repository.mark_failed(
            handoff_id=claimed.id,
            generation=claimed.generation,
            error=self._error_text(error),
            failed_at=now,
            lease_owner=claimed.lease_owner,
            lease_token=claimed.lease_token,
        )
        return WorkflowHandoffResumeResult(
            outcome=(WorkflowHandoffResumeOutcome.FAILED if marked else WorkflowHandoffResumeOutcome.LEASE_LOST),
            handoff_id=claimed.id,
            generation=claimed.generation,
            error=self._error_text(error),
        )

    @staticmethod
    def _error_text(error: Exception) -> str:
        text = str(error) or error.__class__.__name__
        return text[:4000]


__all__ = [
    "MappingWorkflowHandoffResumeDispatcher",
    "PermanentWorkflowHandoffResumeError",
    "UnsupportedWorkflowHandoffResumeRouteError",
    "WorkflowHandoffLease",
    "WorkflowHandoffResumeCoordinator",
    "WorkflowHandoffResumeDispatcher",
    "WorkflowHandoffResumeHandler",
    "WorkflowHandoffResumeOutcome",
    "WorkflowHandoffResumeRequest",
    "WorkflowHandoffResumeResult",
]
