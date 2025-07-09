"""
API WorkflowRun Repository Protocol

This module defines the protocol for service-layer WorkflowRun operations.
The repository provides an abstraction layer for WorkflowRun database operations
used by service classes, separating service-layer concerns from core domain logic.

Key Features:
- Paginated workflow run queries with filtering
- Bulk deletion operations with OSS backup support
- Multi-tenant data isolation
- Expired record cleanup with data retention
- Service-layer specific query patterns

Usage:
    This protocol should be used by service classes that need to perform
    WorkflowRun database operations. It provides a clean interface that
    hides implementation details and supports dependency injection.

Example:
    ```python
    from repositories.dify_api_repository_factory import DifyAPIRepositoryFactory

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    # Get paginated workflow runs
    runs = repo.get_paginated_workflow_runs(
        tenant_id="tenant-123",
        app_id="app-456",
        triggered_from="debugging",
        limit=20
    )
    ```
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Optional, Protocol

from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.workflow import WorkflowRun


class APIWorkflowRunRepository(WorkflowExecutionRepository, Protocol):
    """
    Protocol for service-layer WorkflowRun repository operations.

    This protocol defines the interface for WorkflowRun database operations
    that are specific to service-layer needs, including pagination, filtering,
    and bulk operations with data backup support.
    """

    def get_paginated_workflow_runs(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        limit: int = 20,
        last_id: Optional[str] = None,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs with filtering.

        Retrieves workflow runs for a specific app and trigger source with
        cursor-based pagination support. Used primarily for debugging and
        workflow run listing in the UI.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "debugging", "app-run")
            limit: Maximum number of records to return (default: 20)
            last_id: Cursor for pagination - ID of the last record from previous page

        Returns:
            InfiniteScrollPagination object containing:
            - data: List of WorkflowRun objects
            - limit: Applied limit
            - has_more: Boolean indicating if more records exist

        Raises:
            ValueError: If last_id is provided but the corresponding record doesn't exist
        """
        ...

    def get_workflow_run_by_id(
        self,
        tenant_id: str,
        app_id: str,
        run_id: str,
    ) -> Optional[WorkflowRun]:
        """
        Get a specific workflow run by ID.

        Retrieves a single workflow run with tenant and app isolation.
        Used for workflow run detail views and execution tracking.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            run_id: Workflow run identifier

        Returns:
            WorkflowRun object if found, None otherwise
        """
        ...

    def get_expired_runs_batch(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> Sequence[WorkflowRun]:
        """
        Get a batch of expired workflow runs for cleanup.

        Retrieves workflow runs created before the specified date for
        cleanup operations. Used by scheduled tasks to remove old data
        while maintaining data retention policies.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            before_date: Only return runs created before this date
            batch_size: Maximum number of records to return

        Returns:
            Sequence of WorkflowRun objects to be processed for cleanup
        """
        ...

    def delete_runs_by_ids(
        self,
        run_ids: Sequence[str],
    ) -> int:
        """
        Delete workflow runs by their IDs.

        Performs bulk deletion of workflow runs by ID. This method should
        be used after backing up the data to OSS storage for retention.

        Args:
            run_ids: Sequence of workflow run IDs to delete

        Returns:
            Number of records actually deleted

        Note:
            This method performs hard deletion. Ensure data is backed up
            to OSS storage before calling this method for compliance with
            data retention policies.
        """
        ...

    def delete_runs_by_app(
        self,
        tenant_id: str,
        app_id: str,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete all workflow runs for a specific app.

        Performs bulk deletion of all workflow runs associated with an app.
        Used during app cleanup operations. Processes records in batches
        to avoid memory issues and long-running transactions.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            batch_size: Number of records to process in each batch

        Returns:
            Total number of records deleted across all batches

        Note:
            This method performs hard deletion without backup. Use with caution
            and ensure proper data retention policies are followed.
        """
        ...
