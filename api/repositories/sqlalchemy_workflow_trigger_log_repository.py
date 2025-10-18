"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.orm import Session

from models.trigger import WorkflowTriggerLog, WorkflowTriggerStatus
from repositories.workflow_trigger_log_repository import TriggerLogOrderBy, WorkflowTriggerLogRepository


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

    def get_by_id(self, trigger_log_id: str, tenant_id: Optional[str] = None) -> Optional[WorkflowTriggerLog]:
        """Get a trigger log by its ID."""
        query = select(WorkflowTriggerLog).where(WorkflowTriggerLog.id == trigger_log_id)

        if tenant_id:
            query = query.where(WorkflowTriggerLog.tenant_id == tenant_id)

        return self.session.scalar(query)

    def get_by_status(
        self,
        tenant_id: str,
        app_id: str,
        status: WorkflowTriggerStatus,
        limit: int = 100,
        offset: int = 0,
        order_by: TriggerLogOrderBy = TriggerLogOrderBy.CREATED_AT,
        order_desc: bool = True,
    ) -> Sequence[WorkflowTriggerLog]:
        """Get trigger logs by status with pagination."""
        query = select(WorkflowTriggerLog).where(
            and_(
                WorkflowTriggerLog.tenant_id == tenant_id,
                WorkflowTriggerLog.app_id == app_id,
                WorkflowTriggerLog.status == status,
            )
        )

        # Apply ordering
        order_column = getattr(WorkflowTriggerLog, order_by.value)
        if order_desc:
            query = query.order_by(order_column.desc())
        else:
            query = query.order_by(order_column.asc())

        # Apply pagination
        query = query.limit(limit).offset(offset)

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

    def count_by_status(
        self,
        tenant_id: str,
        app_id: str,
        status: Optional[WorkflowTriggerStatus] = None,
        since: Optional[datetime] = None,
    ) -> int:
        """Count trigger logs by status."""
        query = select(func.count(WorkflowTriggerLog.id)).where(
            and_(WorkflowTriggerLog.tenant_id == tenant_id, WorkflowTriggerLog.app_id == app_id)
        )

        if status:
            query = query.where(WorkflowTriggerLog.status == status)

        if since:
            query = query.where(WorkflowTriggerLog.created_at >= since)

        return self.session.scalar(query) or 0

    def delete_expired_logs(self, tenant_id: str, before_date: datetime, batch_size: int = 1000) -> int:
        """Delete expired trigger logs in batches."""
        total_deleted = 0

        while True:
            # Get batch of IDs to delete
            subquery = (
                select(WorkflowTriggerLog.id)
                .where(and_(WorkflowTriggerLog.tenant_id == tenant_id, WorkflowTriggerLog.created_at < before_date))
                .limit(batch_size)
            )

            # Delete the batch
            result = self.session.execute(delete(WorkflowTriggerLog).where(WorkflowTriggerLog.id.in_(subquery)))

            deleted = result.rowcount
            total_deleted += deleted

            if deleted < batch_size:
                break

            self.session.commit()

        return total_deleted

    def archive_completed_logs(
        self, tenant_id: str, before_date: datetime, batch_size: int = 1000
    ) -> Sequence[WorkflowTriggerLog]:
        """Get completed logs for archival."""
        query = (
            select(WorkflowTriggerLog)
            .where(
                and_(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.status == WorkflowTriggerStatus.SUCCEEDED,
                    WorkflowTriggerLog.finished_at < before_date,
                )
            )
            .limit(batch_size)
        )

        return list(self.session.scalars(query).all())

    def update_status_batch(
        self, trigger_log_ids: Sequence[str], new_status: WorkflowTriggerStatus, error_message: Optional[str] = None
    ) -> int:
        """Update status for multiple trigger logs."""
        update_data: dict[str, Any] = {"status": new_status}

        if error_message is not None:
            update_data["error"] = error_message

        if new_status in [WorkflowTriggerStatus.SUCCEEDED, WorkflowTriggerStatus.FAILED]:
            update_data["finished_at"] = datetime.now(UTC)

        result = self.session.execute(
            update(WorkflowTriggerLog).where(WorkflowTriggerLog.id.in_(trigger_log_ids)).values(**update_data)
        )

        return result.rowcount
