"""
SQLAlchemy implementation of WorkflowNodeExecutionServiceRepository.

This module provides a concrete implementation of the service repository protocol
using SQLAlchemy 2.0 style queries for WorkflowNodeExecutionModel operations.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowNodeExecutionModel
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository


class DifyAPISQLAlchemyWorkflowNodeExecutionRepository(DifyAPIWorkflowNodeExecutionRepository):
    """
    SQLAlchemy implementation of DifyAPIWorkflowNodeExecutionRepository.

    This repository provides service-layer database operations for WorkflowNodeExecutionModel
    using SQLAlchemy 2.0 style queries. It implements the DifyAPIWorkflowNodeExecutionRepository
    protocol with the following features:

    - Multi-tenancy data isolation through tenant_id filtering
    - Direct database model operations without domain conversion
    - Batch processing for efficient large-scale operations
    - Optimized query patterns for common access patterns
    - Dependency injection for better testability and maintainability
    - Session management and transaction handling with proper cleanup
    - Maintenance operations for data lifecycle management
    - Thread-safe database operations using session-per-request pattern
    """

    def __init__(self, session_maker: sessionmaker[Session]):
        """
        Initialize the repository with a sessionmaker.

        Args:
            session_maker: SQLAlchemy sessionmaker for creating database sessions
        """
        self._session_maker = session_maker

    def get_node_last_execution(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> Optional[WorkflowNodeExecutionModel]:
        """
        Get the most recent execution for a specific node.

        This method replicates the query pattern from WorkflowService.get_node_last_run()
        using SQLAlchemy 2.0 style syntax.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            workflow_id: The workflow identifier
            node_id: The node identifier

        Returns:
            The most recent WorkflowNodeExecutionModel for the node, or None if not found
        """
        stmt = (
            select(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.app_id == app_id,
                WorkflowNodeExecutionModel.workflow_id == workflow_id,
                WorkflowNodeExecutionModel.node_id == node_id,
            )
            .order_by(desc(WorkflowNodeExecutionModel.created_at))
            .limit(1)
        )

        with self._session_maker() as session:
            return session.scalar(stmt)

    def get_executions_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get all node executions for a specific workflow run.

        This method replicates the query pattern from WorkflowRunService.get_workflow_run_node_executions()
        using SQLAlchemy 2.0 style syntax.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            workflow_run_id: The workflow run identifier

        Returns:
            A sequence of WorkflowNodeExecutionModel instances ordered by index (desc)
        """
        stmt = (
            select(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.app_id == app_id,
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
            )
            .order_by(desc(WorkflowNodeExecutionModel.index))
        )

        with self._session_maker() as session:
            return session.execute(stmt).scalars().all()

    def get_execution_by_id(
        self,
        execution_id: str,
        tenant_id: Optional[str] = None,
    ) -> Optional[WorkflowNodeExecutionModel]:
        """
        Get a workflow node execution by its ID.

        This method replicates the query pattern from WorkflowDraftVariableService
        and WorkflowService.single_step_run_workflow_node() using SQLAlchemy 2.0 style syntax.

        When `tenant_id` is None, it's the caller's responsibility to ensure proper data isolation between tenants.
        If the `execution_id` comes from untrusted sources (e.g., retrieved from an API request), the caller should
        set `tenant_id` to prevent horizontal privilege escalation.

        Args:
            execution_id: The execution identifier
            tenant_id: Optional tenant identifier for additional filtering

        Returns:
            The WorkflowNodeExecutionModel if found, or None if not found
        """
        stmt = select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution_id)

        # Add tenant filtering if provided
        if tenant_id is not None:
            stmt = stmt.where(WorkflowNodeExecutionModel.tenant_id == tenant_id)

        with self._session_maker() as session:
            return session.scalar(stmt)

    def delete_expired_executions(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete workflow node executions that are older than the specified date.

        Args:
            tenant_id: The tenant identifier
            before_date: Delete executions created before this date
            batch_size: Maximum number of executions to delete in one batch

        Returns:
            The number of executions deleted
        """
        total_deleted = 0

        while True:
            with self._session_maker() as session:
                # Find executions to delete in batches
                stmt = (
                    select(WorkflowNodeExecutionModel.id)
                    .where(
                        WorkflowNodeExecutionModel.tenant_id == tenant_id,
                        WorkflowNodeExecutionModel.created_at < before_date,
                    )
                    .limit(batch_size)
                )

                execution_ids = session.execute(stmt).scalars().all()
                if not execution_ids:
                    break

                # Delete the batch
                delete_stmt = delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(execution_ids))
                result = session.execute(delete_stmt)
                session.commit()
                total_deleted += result.rowcount

                # If we deleted fewer than the batch size, we're done
                if len(execution_ids) < batch_size:
                    break

        return total_deleted

    def delete_executions_by_app(
        self,
        tenant_id: str,
        app_id: str,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete all workflow node executions for a specific app.

        Args:
            tenant_id: The tenant identifier
            app_id: The application identifier
            batch_size: Maximum number of executions to delete in one batch

        Returns:
            The total number of executions deleted
        """
        total_deleted = 0

        while True:
            with self._session_maker() as session:
                # Find executions to delete in batches
                stmt = (
                    select(WorkflowNodeExecutionModel.id)
                    .where(
                        WorkflowNodeExecutionModel.tenant_id == tenant_id,
                        WorkflowNodeExecutionModel.app_id == app_id,
                    )
                    .limit(batch_size)
                )

                execution_ids = session.execute(stmt).scalars().all()
                if not execution_ids:
                    break

                # Delete the batch
                delete_stmt = delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(execution_ids))
                result = session.execute(delete_stmt)
                session.commit()
                total_deleted += result.rowcount

                # If we deleted fewer than the batch size, we're done
                if len(execution_ids) < batch_size:
                    break

        return total_deleted

    def get_expired_executions_batch(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get a batch of expired workflow node executions for backup purposes.

        Args:
            tenant_id: The tenant identifier
            before_date: Get executions created before this date
            batch_size: Maximum number of executions to retrieve

        Returns:
            A sequence of WorkflowNodeExecutionModel instances
        """
        stmt = (
            select(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.created_at < before_date,
            )
            .limit(batch_size)
        )

        with self._session_maker() as session:
            return session.execute(stmt).scalars().all()

    def delete_executions_by_ids(
        self,
        execution_ids: Sequence[str],
    ) -> int:
        """
        Delete workflow node executions by their IDs.

        Args:
            execution_ids: List of execution IDs to delete

        Returns:
            The number of executions deleted
        """
        if not execution_ids:
            return 0

        with self._session_maker() as session:
            stmt = delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(execution_ids))
            result = session.execute(stmt)
            session.commit()
            return result.rowcount
