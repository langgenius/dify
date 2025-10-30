"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, select
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
