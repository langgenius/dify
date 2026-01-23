"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import and_, delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.enums import WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from repositories.workflow_trigger_log_repository import WorkflowTriggerLogRepository


class SQLAlchemyWorkflowTriggerLogRepository(WorkflowTriggerLogRepository):
    """
    SQLAlchemy implementation of WorkflowTriggerLogRepository.

    Optimized for large table operations with proper indexing and batch processing.
    """

    def __init__(self, session: Session):
        self.session = session

    def create(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Create a new trigger log entry."""
        self.session.add(trigger_log)
        self.session.flush()
        return trigger_log

    def update(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Update an existing trigger log entry."""
        self.session.merge(trigger_log)
        self.session.flush()
        return trigger_log

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
