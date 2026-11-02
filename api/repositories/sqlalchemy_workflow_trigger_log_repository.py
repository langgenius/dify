"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import cast, override

from sqlalchemy import and_, delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from graphon.enums import WorkflowExecutionStatus
from models.enums import WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowPause, WorkflowRun
from repositories.workflow_trigger_log_repository import WorkflowTriggerLogRepository


class SQLAlchemyWorkflowTriggerLogRepository(WorkflowTriggerLogRepository):
    """
    SQLAlchemy implementation of WorkflowTriggerLogRepository.

    Optimized for large table operations with proper indexing and batch processing.
    """

    def __init__(self, session: Session):
        self.session = session

    @override
    def create(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Create a new trigger log entry."""
        self.session.add(trigger_log)
        self.session.flush()
        return trigger_log

    @override
    def update(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Update an existing trigger log entry."""
        self.session.merge(trigger_log)
        self.session.flush()
        return trigger_log

    def reconcile_published_run_result(self, workflow_run_id: str, *, include_paused: bool = False) -> bool:
        """Repair the trigger projection without starting another execution.

        The SQL control run is authoritative. Lock it before the trigger row so
        a concurrent resume cannot turn a pause into RUNNING during this copy.
        """
        run = self.session.scalar(
            select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update(read=True)
        )
        if run is None:
            return True
        statuses = {
            WorkflowExecutionStatus.SUCCEEDED: WorkflowTriggerStatus.SUCCEEDED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED: WorkflowTriggerStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED: WorkflowTriggerStatus.FAILED,
            WorkflowExecutionStatus.STOPPED: WorkflowTriggerStatus.FAILED,
        }
        if run.status == WorkflowExecutionStatus.PAUSED and include_paused:
            pause = self.session.scalar(
                select(WorkflowPause.id).where(
                    WorkflowPause.workflow_run_id == run.id,
                    WorkflowPause.workflow_id == run.workflow_id,
                    WorkflowPause.resumed_at.is_(None),
                )
            )
            if pause is None:
                return False
            status = WorkflowTriggerStatus.PAUSED
        else:
            status = statuses.get(run.status)
            if status is None:
                return False
        trigger = self.session.scalar(
            select(WorkflowTriggerLog)
            .where(
                WorkflowTriggerLog.workflow_run_id == run.id,
                WorkflowTriggerLog.tenant_id == run.tenant_id,
                WorkflowTriggerLog.app_id == run.app_id,
                WorkflowTriggerLog.workflow_id == run.workflow_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if trigger is not None:
            trigger.status = status
            trigger.outputs = run.outputs
            trigger.error = run.error
            trigger.total_tokens = run.total_tokens
            trigger.elapsed_time = run.elapsed_time
            trigger.finished_at = run.finished_at if status != WorkflowTriggerStatus.PAUSED else None
            self.session.flush()
        return True

    def record_dispatch(
        self,
        *,
        trigger_log_id: str,
        tenant_id: str,
        task_id: str,
        triggered_at: datetime,
    ) -> None:
        """Record acceptance without replacing state already published by a worker."""
        trigger_log = self._lock_dispatch_log(trigger_log_id=trigger_log_id, tenant_id=tenant_id)
        if trigger_log is None:
            return
        if trigger_log.status == WorkflowTriggerStatus.PENDING:
            trigger_log.status = WorkflowTriggerStatus.QUEUED
        trigger_log.celery_task_id = task_id
        trigger_log.triggered_at = trigger_log.triggered_at or triggered_at
        self.session.flush()

    def fail_pending_dispatch(self, *, trigger_log_id: str, tenant_id: str, error: str) -> None:
        """A failed producer cannot overwrite a worker that already accepted the message."""
        trigger_log = self._lock_dispatch_log(trigger_log_id=trigger_log_id, tenant_id=tenant_id)
        if trigger_log is None or trigger_log.status != WorkflowTriggerStatus.PENDING:
            return
        trigger_log.status = WorkflowTriggerStatus.FAILED
        trigger_log.error = error
        self.session.flush()

    def _lock_dispatch_log(self, *, trigger_log_id: str, tenant_id: str) -> WorkflowTriggerLog | None:
        return self.session.scalar(
            select(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.id == trigger_log_id, WorkflowTriggerLog.tenant_id == tenant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def claim_for_execution(self, *, trigger_log_id: str) -> WorkflowTriggerLog | None:
        """Claim an executable trigger log while holding its database row lock.

        Only pre-execution states are claimable. A redelivered ``RUNNING`` row
        has an unknown external side-effect boundary and must not start another
        workflow run automatically.
        """
        trigger_log = self.lock_for_execution_update(trigger_log_id=trigger_log_id)
        if trigger_log is None:
            return None
        if trigger_log.status not in {WorkflowTriggerStatus.PENDING, WorkflowTriggerStatus.QUEUED}:
            return None
        trigger_log.status = WorkflowTriggerStatus.RUNNING
        self.session.flush()
        return trigger_log

    def lock_for_execution_update(self, *, trigger_log_id: str) -> WorkflowTriggerLog | None:
        """Lock and refresh one trigger log before an execution-state write."""
        return self.session.scalar(
            select(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.id == trigger_log_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    @override
    def get_by_id(self, trigger_log_id: str, tenant_id: str | None = None) -> WorkflowTriggerLog | None:
        """Get a trigger log by its ID."""
        query = select(WorkflowTriggerLog).where(WorkflowTriggerLog.id == trigger_log_id)

        if tenant_id:
            query = query.where(WorkflowTriggerLog.tenant_id == tenant_id)

        return self.session.scalar(query)

    def list_by_run_id(self, run_id: str) -> Sequence[WorkflowTriggerLog]:
        """List trigger logs for a workflow run."""
        query = select(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id == run_id)
        return list(self.session.scalars(query).all())

    @override
    def get_failed_for_retry(
        self, tenant_id: str, max_retry_count: int = 3, limit: int = 100
    ) -> Sequence[WorkflowTriggerLog]:
        """Get failed trigger logs eligible for retry."""
        query = (
            select(WorkflowTriggerLog)
            .where(
                and_(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.status.in_([WorkflowTriggerStatus.FAILED, WorkflowTriggerStatus.RATE_LIMITED]),
                    WorkflowTriggerLog.retry_count < max_retry_count,
                )
            )
            .order_by(WorkflowTriggerLog.created_at.asc())
            .limit(limit)
        )

        return list(self.session.scalars(query).all())

    @override
    def get_recent_logs(
        self, tenant_id: str, app_id: str, hours: int = 24, limit: int = 100, offset: int = 0
    ) -> Sequence[WorkflowTriggerLog]:
        """Get recent trigger logs within specified hours."""
        since = datetime.now(UTC) - timedelta(hours=hours)

        query = (
            select(WorkflowTriggerLog)
            .where(
                and_(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.app_id == app_id,
                    WorkflowTriggerLog.created_at >= since,
                )
            )
            .order_by(WorkflowTriggerLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(self.session.scalars(query).all())

    @override
    def get_by_workflow_run_id(self, workflow_run_id: str) -> WorkflowTriggerLog | None:
        """Get the trigger log associated with a workflow run."""
        query = (
            select(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.workflow_run_id == workflow_run_id)
            .order_by(WorkflowTriggerLog.created_at.desc())
            .limit(1)
        )
        return self.session.scalar(query)

    @override
    def delete_by_run_ids(self, run_ids: Sequence[str]) -> int:
        """
        Delete trigger logs associated with the given workflow run ids.

        Args:
            run_ids: Collection of workflow run identifiers.

        Returns:
            Number of rows deleted.
        """
        if not run_ids:
            return 0

        result = self.session.execute(delete(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id.in_(run_ids)))
        return cast(CursorResult, result).rowcount or 0

    def count_by_run_ids(self, run_ids: Sequence[str]) -> int:
        """
        Count trigger logs associated with the given workflow run ids.

        Args:
            run_ids: Collection of workflow run identifiers.

        Returns:
            Number of rows matched.
        """
        if not run_ids:
            return 0

        count = self.session.scalar(
            select(func.count()).select_from(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id.in_(run_ids))
        )
        return int(count or 0)
