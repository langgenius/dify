"""Shared locked write rules for synchronous and queued execution persistence."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowDebugReservation, WorkflowRun


@dataclass(frozen=True)
class DebugLease:
    """Persisted handoff/worker deadline; None suspends expiry during a pause."""

    expires_at: datetime | None
    started_at: datetime | None = None


def read_debug_lease(session: Session, run: WorkflowRun) -> DebugLease | None:
    reservation = session.get(WorkflowDebugReservation, run.id)
    if reservation is None:
        return None
    return DebugLease(reservation.expires_at, reservation.started_at)


def write_debug_lease(session: Session, run: WorkflowRun, lease: DebugLease | None) -> None:
    """Stage lease changes while the caller owns the corresponding execution lock."""
    reservation = session.get(WorkflowDebugReservation, run.id)
    if lease is None:
        if reservation is not None:
            session.delete(reservation)
    else:
        if reservation is None:
            reservation = WorkflowDebugReservation(workflow_run_id=run.id)
            session.add(reservation)
        reservation.expires_at = None if run.status == WorkflowExecutionStatus.PAUSED else lease.expires_at
        reservation.started_at = lease.started_at


def sync_debug_lease_status(session: Session, run: WorkflowRun) -> None:
    """Schedule terminal cleanup or suspend expiry in the status write transaction."""
    if run.triggered_from != WorkflowRunTriggeredFrom.DEBUGGING:
        return
    lease = read_debug_lease(session, run)
    if lease is not None:
        if run.status == WorkflowExecutionStatus.PAUSED:
            write_debug_lease(session, run, DebugLease(None, lease.started_at))
        elif run.status.is_ended():
            now = naive_utc_now()
            write_debug_lease(session, run, DebugLease(min(lease.expires_at or now, now), lease.started_at))


def lock_workflow_run(
    session: Session, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str
) -> WorkflowRun | None:
    return session.scalar(
        select(WorkflowRun)
        .where(
            WorkflowRun.id == execution_id,
            WorkflowRun.tenant_id == tenant_id,
            WorkflowRun.app_id == app_id,
            WorkflowRun.workflow_id == workflow_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def save_workflow_run(session: Session, incoming: WorkflowRun) -> bool:
    """Stage an owned execution write; the caller commits the locked transaction.

    The first terminal status wins. Same-status terminal writes may fill in
    delayed metrics and outputs, but stale RUNNING/PAUSED or conflicting terminal
    writes cannot revive or reclassify a completed execution. Only the explicit
    resume_workflow_pause transaction may transition PAUSED back to RUNNING;
    queued start records are observations, never resume commands.
    Every adapter preserves the initial start timestamp.
    """
    current = lock_workflow_run(
        session,
        tenant_id=incoming.tenant_id,
        app_id=incoming.app_id,
        workflow_id=incoming.workflow_id,
        execution_id=incoming.id,
    )
    if current is None:
        if session.scalar(select(WorkflowRun.id).where(WorkflowRun.id == incoming.id)) is not None:
            raise ValueError("Unauthorized access to workflow run")
        session.add(incoming)
    else:
        if current.status.is_ended() and incoming.status != current.status:
            return False
        if current.status == WorkflowExecutionStatus.PAUSED and incoming.status == WorkflowExecutionStatus.RUNNING:
            return False
        incoming.created_at = current.created_at
        incoming = session.merge(incoming)
    sync_debug_lease_status(session, incoming)
    return True


class WorkflowExecutionWriteRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def finish(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        execution_id: str,
        status: WorkflowExecutionStatus | None = None,
        cancel: bool = False,
    ) -> WorkflowExecutionStatus | None:
        """Commit the engine outcome before exposing it to clients.

        None means no owned execution could be finalized. Without an observed
        outcome, preserve pauses and fail unfinished runs. Cancellation only
        owns unclaimed reservations, whose rows survive for cleanup retries.
        """
        with self._sessions.begin() as session:
            run = lock_workflow_run(
                session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, execution_id=execution_id
            )
            if run is None:
                return None
            if cancel:
                reservation = read_debug_lease(session, run)
                if (
                    reservation is None
                    or reservation.started_at is not None
                    or run.status == WorkflowExecutionStatus.PAUSED
                ):
                    return None
                now = naive_utc_now()
                if not run.status.is_ended():
                    run.status = WorkflowExecutionStatus.STOPPED
                    run.finished_at = now
                write_debug_lease(
                    session, run, DebugLease(min(reservation.expires_at or now, now), reservation.started_at)
                )
            elif not run.status.is_ended():
                if status is not None:
                    run.status = status
                elif run.status != WorkflowExecutionStatus.PAUSED:
                    run.status = WorkflowExecutionStatus.FAILED
                    run.error = "Trigger debugging ended before a terminal execution record was saved"
                if run.status.is_ended():
                    run.finished_at = naive_utc_now()
            sync_debug_lease_status(session, run)
            return run.status
