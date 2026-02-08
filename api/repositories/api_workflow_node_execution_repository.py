"""
Service-layer repository protocol for WorkflowNodeExecutionModel operations.

This module provides a protocol interface for service-layer operations on WorkflowNodeExecutionModel
that abstracts database queries currently done directly in service classes. This repository is
specifically designed for service-layer needs and is separate from the core domain repository.

The service repository handles operations that require access to database-specific fields like
tenant_id, app_id, triggered_from, etc., which are not part of the core domain model.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session

from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload


class DifyAPIWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository, Protocol):
    """
    Protocol for service-layer operations on WorkflowNodeExecutionModel.

    This repository provides database access patterns specifically needed by service classes,
    handling queries that involve database-specific fields and multi-tenancy concerns.

    Key responsibilities:
    - Manages database operations for workflow node executions
    - Handles multi-tenant data isolation
    - Provides batch processing capabilities
    - Supports execution lifecycle management

    Implementation notes:
    - Returns database models directly (WorkflowNodeExecutionModel)
    - Handles tenant/app filtering automatically
    - Provides service-specific query patterns
    - Focuses on database operations without domain logic
    - Supports cleanup and maintenance operations
    """

    def get_node_last_execution(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> WorkflowNodeExecutionModel | None:
        """
        Get the most recent execution for a specific node.

        This method finds the latest execution of a specific node within a workflow,
        ordered by creation time. Used primarily for debugging and inspection purposes.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            workflow_id: The workflow identifier
            node_id: The node identifier

        Returns:
            The most recent WorkflowNodeExecutionModel for the node, or None if not found
        """
        ...

    def get_executions_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get all node executions for a specific workflow run.

        This method retrieves all node executions that belong to a specific workflow run,
        ordered by index in descending order for proper trace visualization.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            workflow_run_id: The workflow run identifier

        Returns:
            A sequence of WorkflowNodeExecutionModel instances ordered by index (desc)
        """
        ...

    def get_execution_by_id(
        self,
        execution_id: str,
        tenant_id: str | None = None,
    ) -> WorkflowNodeExecutionModel | None:
        """
        Get a workflow node execution by its ID.

        This method retrieves a specific execution by its unique identifier.
        Tenant filtering is optional for cases where the execution ID is globally unique.

        When `tenant_id` is None, it's the caller's responsibility to ensure proper data isolation between tenants.
        If the `execution_id` comes from untrusted sources (e.g., retrieved from an API request), the caller should
        set `tenant_id` to prevent horizontal privilege escalation.

        Args:
            execution_id: The execution identifier
            tenant_id: Optional tenant identifier for additional filtering

        Returns:
            The WorkflowNodeExecutionModel if found, or None if not found
        """
        ...

    def delete_expired_executions(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete workflow node executions that are older than the specified date.

        This method is used for cleanup operations to remove expired executions
        in batches to avoid overwhelming the database.

        Args:
            tenant_id: The tenant identifier
            before_date: Delete executions created before this date
            batch_size: Maximum number of executions to delete in one batch

        Returns:
            The number of executions deleted
        """
        ...

    def count_by_runs(self, session: Session, run_ids: Sequence[str]) -> tuple[int, int]:
        """
        Count node executions and offloads for the given workflow run ids.
        """
        ...

    def delete_by_runs(self, session: Session, run_ids: Sequence[str]) -> tuple[int, int]:
        """
        Delete node executions and offloads for the given workflow run ids.
        """
        ...

    def delete_executions_by_app(
        self,
        tenant_id: str,
        app_id: str,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete all workflow node executions for a specific app.

        This method is used when removing an app and all its related data.
        Executions are deleted in batches to avoid overwhelming the database.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            batch_size: Maximum number of executions to delete in one batch

        Returns:
            The total number of executions deleted
        """
        ...

    def get_expired_executions_batch(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get a batch of expired workflow node executions for backup purposes.

        This method retrieves expired executions without deleting them,
        allowing the caller to backup the data before deletion.

        Args:
            tenant_id: The tenant identifier
            before_date: Get executions created before this date
            batch_size: Maximum number of executions to retrieve

        Returns:
            A sequence of WorkflowNodeExecutionModel instances
        """
        ...

    def delete_executions_by_ids(
        self,
        execution_ids: Sequence[str],
    ) -> int:
        """
        Delete workflow node executions by their IDs.

        This method deletes specific executions by their IDs,
        typically used after backing up the data.

        This method does not perform tenant isolation checks. The caller is responsible for ensuring proper
        data isolation between tenants. When execution IDs come from untrusted sources (e.g., API requests),
        additional tenant validation should be implemented to prevent unauthorized access.

        Args:
            execution_ids: List of execution IDs to delete

        Returns:
            The number of executions deleted
        """
        ...

    def get_offloads_by_execution_ids(
        self,
        session: Session,
        node_execution_ids: Sequence[str],
    ) -> Sequence[WorkflowNodeExecutionOffload]:
        """
        Get offload records by node execution IDs.

        This method retrieves workflow node execution offload records
        that belong to the given node execution IDs.

        Args:
            session: The database session to use
            node_execution_ids: List of node execution IDs to filter by

        Returns:
            A sequence of WorkflowNodeExecutionOffload instances
        """
        ...
