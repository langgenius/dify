"""
SQLAlchemy implementation of WorkflowNodeExecutionServiceRepository.

This module provides a concrete implementation of the service repository protocol
using SQLAlchemy 2.0 style queries for WorkflowNodeExecutionModel operations.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import cast

from sqlalchemy import asc, delete, desc, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
)
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
    ) -> WorkflowNodeExecutionModel | None:
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
            The most recent WorkflowNodeExecutionModel for the node, or None if not found.

            The returned WorkflowNodeExecutionModel will have `offload_data` preloaded.
        """
        stmt = select(WorkflowNodeExecutionModel)
        stmt = WorkflowNodeExecutionModel.preload_offload_data(stmt)
        stmt = (
            stmt.where(
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
        stmt = WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
        stmt = stmt.where(
            WorkflowNodeExecutionModel.tenant_id == tenant_id,
            WorkflowNodeExecutionModel.app_id == app_id,
            WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
        ).order_by(asc(WorkflowNodeExecutionModel.created_at))

        with self._session_maker() as session:
            return session.execute(stmt).scalars().all()

    def get_execution_by_id(
        self,
        execution_id: str,
        tenant_id: str | None = None,
    ) -> WorkflowNodeExecutionModel | None:
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
        stmt = WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
        stmt = stmt.where(WorkflowNodeExecutionModel.id == execution_id)

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
                result = cast(CursorResult, session.execute(delete_stmt))
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
                result = cast(CursorResult, session.execute(delete_stmt))
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
            result = cast(CursorResult, session.execute(stmt))
            session.commit()
            return result.rowcount

    def delete_by_runs(self, session: Session, run_ids: Sequence[str]) -> tuple[int, int]:
        """
        Delete node executions (and offloads) for the given workflow runs using workflow_run_id.
        """
        if not run_ids:
            return 0, 0

        run_ids = list(run_ids)
        run_id_filter = WorkflowNodeExecutionModel.workflow_run_id.in_(run_ids)
        node_execution_ids = select(WorkflowNodeExecutionModel.id).where(run_id_filter)

        offloads_deleted = (
            cast(
                CursorResult,
                session.execute(
                    delete(WorkflowNodeExecutionOffload).where(
                        WorkflowNodeExecutionOffload.node_execution_id.in_(node_execution_ids)
                    )
                ),
            ).rowcount
            or 0
        )

        node_executions_deleted = (
            cast(
                CursorResult,
                session.execute(delete(WorkflowNodeExecutionModel).where(run_id_filter)),
            ).rowcount
            or 0
        )

        return node_executions_deleted, offloads_deleted

    def count_by_runs(self, session: Session, run_ids: Sequence[str]) -> tuple[int, int]:
        """
        Count node executions (and offloads) for the given workflow runs using workflow_run_id.
        """
        if not run_ids:
            return 0, 0

        run_ids = list(run_ids)
        run_id_filter = WorkflowNodeExecutionModel.workflow_run_id.in_(run_ids)

        node_executions_count = (
            session.scalar(select(func.count()).select_from(WorkflowNodeExecutionModel).where(run_id_filter)) or 0
        )
        node_execution_ids = select(WorkflowNodeExecutionModel.id).where(run_id_filter)
        offloads_count = (
            session.scalar(
                select(func.count())
                .select_from(WorkflowNodeExecutionOffload)
                .where(WorkflowNodeExecutionOffload.node_execution_id.in_(node_execution_ids))
            )
            or 0
        )

        return int(node_executions_count), int(offloads_count)

    @staticmethod
    def get_by_run(
        session: Session,
        run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Fetch node executions for a run using workflow_run_id.
        """
        stmt = select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id == run_id)
        return list(session.scalars(stmt))

    def get_offloads_by_execution_ids(
        self,
        session: Session,
        node_execution_ids: Sequence[str],
    ) -> Sequence[WorkflowNodeExecutionOffload]:
        if not node_execution_ids:
            return []

        stmt = select(WorkflowNodeExecutionOffload).where(
            WorkflowNodeExecutionOffload.node_execution_id.in_(node_execution_ids)
        )
        return list(session.scalars(stmt))
