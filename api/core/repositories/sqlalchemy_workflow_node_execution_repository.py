"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

import logging
from collections.abc import Sequence
from typing import Optional

from sqlalchemy import UnaryExpression, asc, delete, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.repository.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionStatus, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class SQLAlchemyWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.
    """

    def __init__(self, session_factory: sessionmaker | Engine, tenant_id: str, app_id: Optional[str] = None):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and tenant context.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant ID for multi-tenancy
            app_id: Optional app ID for filtering by application
        """
        # If an engine is provided, create a sessionmaker from it
        if isinstance(session_factory, Engine):
            self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
        elif isinstance(session_factory, sessionmaker):
            self._session_factory = session_factory
        else:
            raise ValueError(
                f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
            )

        self._tenant_id = tenant_id
        self._app_id = app_id

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save a WorkflowNodeExecution instance and commit changes to the database.

        Args:
            execution: The WorkflowNodeExecution instance to save
        """
        with self._session_factory() as session:
            # Ensure tenant_id is set
            if not execution.tenant_id:
                execution.tenant_id = self._tenant_id

            # Set app_id if provided and not already set
            if self._app_id and not execution.app_id:
                execution.app_id = self._app_id

            session.add(execution)
            session.commit()

    def get_by_node_execution_id(self, node_execution_id: str) -> Optional[WorkflowNodeExecution]:
        """
        Retrieve a WorkflowNodeExecution by its node_execution_id.

        Args:
            node_execution_id: The node execution ID

        Returns:
            The WorkflowNodeExecution instance if found, None otherwise
        """
        with self._session_factory() as session:
            stmt = select(WorkflowNodeExecution).where(
                WorkflowNodeExecution.node_execution_id == node_execution_id,
                WorkflowNodeExecution.tenant_id == self._tenant_id,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            return session.scalar(stmt)

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution instances
        """
        with self._session_factory() as session:
            stmt = select(WorkflowNodeExecution).where(
                WorkflowNodeExecution.workflow_run_id == workflow_run_id,
                WorkflowNodeExecution.tenant_id == self._tenant_id,
                WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            # Apply ordering if provided
            if order_config and order_config.order_by:
                order_columns: list[UnaryExpression] = []
                for field in order_config.order_by:
                    column = getattr(WorkflowNodeExecution, field, None)
                    if not column:
                        continue
                    if order_config.order_direction == "desc":
                        order_columns.append(desc(column))
                    else:
                        order_columns.append(asc(column))

                if order_columns:
                    stmt = stmt.order_by(*order_columns)

            return session.scalars(stmt).all()

    def get_running_executions(self, workflow_run_id: str) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all running WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID

        Returns:
            A list of running WorkflowNodeExecution instances
        """
        with self._session_factory() as session:
            stmt = select(WorkflowNodeExecution).where(
                WorkflowNodeExecution.workflow_run_id == workflow_run_id,
                WorkflowNodeExecution.tenant_id == self._tenant_id,
                WorkflowNodeExecution.status == WorkflowNodeExecutionStatus.RUNNING,
                WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            return session.scalars(stmt).all()

    def update(self, execution: WorkflowNodeExecution) -> None:
        """
        Update an existing WorkflowNodeExecution instance and commit changes to the database.

        Args:
            execution: The WorkflowNodeExecution instance to update
        """
        with self._session_factory() as session:
            # Ensure tenant_id is set
            if not execution.tenant_id:
                execution.tenant_id = self._tenant_id

            # Set app_id if provided and not already set
            if self._app_id and not execution.app_id:
                execution.app_id = self._app_id

            session.merge(execution)
            session.commit()

    def clear(self) -> None:
        """
        Clear all WorkflowNodeExecution records for the current tenant_id and app_id.

        This method deletes all WorkflowNodeExecution records that match the tenant_id
        and app_id (if provided) associated with this repository instance.
        """
        with self._session_factory() as session:
            stmt = delete(WorkflowNodeExecution).where(WorkflowNodeExecution.tenant_id == self._tenant_id)

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            result = session.execute(stmt)
            session.commit()

            deleted_count = result.rowcount
            logger.info(
                f"Cleared {deleted_count} workflow node execution records for tenant {self._tenant_id}"
                + (f" and app {self._app_id}" if self._app_id else "")
            )
