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
from typing import Protocol

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
        triggered_from: str | list[str],
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs with filtering.

        Retrieves workflow runs for a specific app and trigger source with
        cursor-based pagination support. Used primarily for debugging and
        workflow run listing in the UI.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source(s) (e.g., "debugging", "app-run", or list of values)
            limit: Maximum number of records to return (default: 20)
            last_id: Cursor for pagination - ID of the last record from previous page
            status: Optional filter by status (e.g., "running", "succeeded", "failed")

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
    ) -> WorkflowRun | None:
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

    def get_workflow_run_by_id_without_tenant(
        self,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID without tenant/app context.

        Retrieves a single workflow run using only the run ID, without
        requiring tenant_id or app_id. This method is intended for internal
        system operations like tracing and monitoring where the tenant context
        is not available upfront.

        Args:
            run_id: Workflow run identifier

        Returns:
            WorkflowRun object if found, None otherwise

        Note:
            This method bypasses tenant isolation checks and should only be used
            in trusted system contexts like ops trace collection. For user-facing
            operations, use get_workflow_run_by_id() with proper tenant isolation.
        """
        ...

    def get_workflow_runs_count(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        status: str | None = None,
        time_range: str | None = None,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics.

        Retrieves total count and count by status for workflow runs
        matching the specified filters.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "debugging", "app-run")
            status: Optional filter by specific status
            time_range: Optional time range filter (e.g., "7d", "4h", "30m", "30s")
                       Filters records based on created_at field

        Returns:
            Dictionary containing:
            - total: Total count of all workflow runs (or filtered by status)
            - running: Count of workflow runs with status "running"
            - succeeded: Count of workflow runs with status "succeeded"
            - failed: Count of workflow runs with status "failed"
            - stopped: Count of workflow runs with status "stopped"
            - partial_succeeded: Count of workflow runs with status "partial-succeeded"

            Note: If a status is provided, 'total' will be the count for that status,
            and the specific status count will also be set to this value, with all
            other status counts being 0.
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

    def get_daily_runs_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[dict]:
        """
        Get daily runs statistics.

        Retrieves daily workflow runs count grouped by date for a specific app
        and trigger source. Used for workflow statistics dashboard.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "app-run")
            start_date: Optional start date filter
            end_date: Optional end date filter
            timezone: Timezone for date grouping (default: "UTC")

        Returns:
            List of dictionaries containing date and runs count:
            [{"date": "2024-01-01", "runs": 10}, ...]
        """
        ...

    def get_daily_terminals_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[dict]:
        """
        Get daily terminals statistics.

        Retrieves daily unique terminal count grouped by date for a specific app
        and trigger source. Used for workflow statistics dashboard.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "app-run")
            start_date: Optional start date filter
            end_date: Optional end date filter
            timezone: Timezone for date grouping (default: "UTC")

        Returns:
            List of dictionaries containing date and terminal count:
            [{"date": "2024-01-01", "terminal_count": 5}, ...]
        """
        ...

    def get_daily_token_cost_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[dict]:
        """
        Get daily token cost statistics.

        Retrieves daily total token count grouped by date for a specific app
        and trigger source. Used for workflow statistics dashboard.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "app-run")
            start_date: Optional start date filter
            end_date: Optional end date filter
            timezone: Timezone for date grouping (default: "UTC")

        Returns:
            List of dictionaries containing date and token count:
            [{"date": "2024-01-01", "token_count": 1000}, ...]
        """
        ...

    def get_average_app_interaction_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[dict]:
        """
        Get average app interaction statistics.

        Retrieves daily average interactions per user grouped by date for a specific app
        and trigger source. Used for workflow statistics dashboard.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source (e.g., "app-run")
            start_date: Optional start date filter
            end_date: Optional end date filter
            timezone: Timezone for date grouping (default: "UTC")

        Returns:
            List of dictionaries containing date and average interactions:
            [{"date": "2024-01-01", "interactions": 2.5}, ...]
        """
        ...
