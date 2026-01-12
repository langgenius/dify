"""
Repository protocol for WorkflowTriggerLog operations.

This module provides a protocol interface for operations on WorkflowTriggerLog,
designed to efficiently handle a potentially large volume of trigger logs with
proper indexing and batch operations.
"""

from collections.abc import Sequence
from enum import StrEnum
from typing import Protocol

from models.trigger import WorkflowTriggerLog


class TriggerLogOrderBy(StrEnum):
    """Fields available for ordering trigger logs"""

    CREATED_AT = "created_at"
    TRIGGERED_AT = "triggered_at"
    FINISHED_AT = "finished_at"
    STATUS = "status"


class WorkflowTriggerLogRepository(Protocol):
    """
    Protocol for operations on WorkflowTriggerLog.

    This repository provides efficient access patterns for the trigger log table,
    which is expected to grow large over time. It includes:
    - Batch operations for cleanup
    - Efficient queries with proper indexing
    - Pagination support
    - Status-based filtering

    Implementation notes:
    - Leverage database indexes on (tenant_id, app_id), status, and created_at
    - Use batch operations for deletions to avoid locking
    - Support pagination for large result sets
    """

    def create(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """
        Create a new trigger log entry.

        Args:
            trigger_log: The WorkflowTriggerLog instance to create

        Returns:
            The created WorkflowTriggerLog with generated ID
        """
        ...

    def update(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """
        Update an existing trigger log entry.

        Args:
            trigger_log: The WorkflowTriggerLog instance to update

        Returns:
            The updated WorkflowTriggerLog
        """
        ...

    def get_by_id(self, trigger_log_id: str, tenant_id: str | None = None) -> WorkflowTriggerLog | None:
        """
        Get a trigger log by its ID.

        Args:
            trigger_log_id: The trigger log identifier
            tenant_id: Optional tenant identifier for additional security

        Returns:
            The WorkflowTriggerLog if found, None otherwise
        """
        ...

    def get_failed_for_retry(
        self, tenant_id: str, max_retry_count: int = 3, limit: int = 100
    ) -> Sequence[WorkflowTriggerLog]:
        """
        Get failed trigger logs that are eligible for retry.

        Args:
            tenant_id: The tenant identifier
            max_retry_count: Maximum retry count to consider
            limit: Maximum number of results

        Returns:
            A sequence of WorkflowTriggerLog instances eligible for retry
        """
        ...

    def get_recent_logs(
        self, tenant_id: str, app_id: str, hours: int = 24, limit: int = 100, offset: int = 0
    ) -> Sequence[WorkflowTriggerLog]:
        """
        Get recent trigger logs within specified hours.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            hours: Number of hours to look back
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            A sequence of recent WorkflowTriggerLog instances
        """
        ...

    def delete_by_run_ids(self, run_ids: Sequence[str]) -> int:
        """
        Delete trigger logs for workflow run IDs.

        Args:
            run_ids: Workflow run IDs to delete

        Returns:
            Number of rows deleted
        """
        ...
