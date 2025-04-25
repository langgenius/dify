"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

import logging
from collections.abc import Sequence
from typing import Optional

from sqlalchemy import UnaryExpression, asc, delete, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repository.workflow_node_execution_repository import OrderConfig
from core.workflow.entities import WorkflowNodeExecutionStatus
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class SQLAlchemyWorkflowNodeExecutionRepository:
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        app_id: str | None = None,
        workflow_id: str | None = None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None = None,
        created_by_role: str | None = None,
        created_by: str | None = None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context parameters.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant ID for multi-tenancy
            app_id: App ID for filtering by application (optional)
            workflow_id: Workflow ID for filtering by workflow (optional)
            triggered_from: Triggered_from value (WorkflowNodeExecutionTriggeredFrom enum) (optional)
            created_by_role: Creator role (e.g., 'account', 'end_user') (optional)
            created_by: Creator ID (optional)
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
        self._workflow_id = workflow_id
        self._triggered_from = triggered_from
        self._created_by_role = created_by_role
        self._created_by = created_by

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save a WorkflowNodeExecution instance and commit changes to the database.

        Args:
            execution: The WorkflowNodeExecution instance to save
        """
        with self._session_factory() as session:
            # Always set tenant_id from the repository context
            execution.tenant_id = self._tenant_id

            # Set other fields only if they are provided in the repository
            if self._app_id is not None:
                execution.app_id = self._app_id

            if self._workflow_id is not None:
                execution.workflow_id = self._workflow_id

            if self._triggered_from is not None:
                execution.triggered_from = self._triggered_from

            if self._created_by_role is not None:
                execution.created_by_role = self._created_by_role

            if self._created_by is not None:
                execution.created_by = self._created_by

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

            # Apply additional filters if provided
            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            if self._workflow_id:
                stmt = stmt.where(WorkflowNodeExecution.workflow_id == self._workflow_id)

            if self._triggered_from:
                stmt = stmt.where(WorkflowNodeExecution.triggered_from == self._triggered_from)

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
            )

            # Use the triggered_from from the instance if provided, otherwise use the default
            if self._triggered_from:
                stmt = stmt.where(WorkflowNodeExecution.triggered_from == self._triggered_from)
            else:
                # Default behavior for backward compatibility
                stmt = stmt.where(
                    WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
                )

            # Apply additional filters if provided
            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            if self._workflow_id:
                stmt = stmt.where(WorkflowNodeExecution.workflow_id == self._workflow_id)

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
            )

            # Use the triggered_from from the instance if provided, otherwise use the default
            if self._triggered_from:
                stmt = stmt.where(WorkflowNodeExecution.triggered_from == self._triggered_from)
            else:
                # Default behavior for backward compatibility
                stmt = stmt.where(
                    WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
                )

            # Apply additional filters if provided
            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            if self._workflow_id:
                stmt = stmt.where(WorkflowNodeExecution.workflow_id == self._workflow_id)

            return session.scalars(stmt).all()

    def update(self, execution: WorkflowNodeExecution) -> None:
        """
        Update an existing WorkflowNodeExecution instance and commit changes to the database.

        Args:
            execution: The WorkflowNodeExecution instance to update
        """
        with self._session_factory() as session:
            # Always set tenant_id from the repository context
            execution.tenant_id = self._tenant_id

            # Set other fields only if they are provided in the repository
            if self._app_id is not None:
                execution.app_id = self._app_id

            if self._workflow_id is not None:
                execution.workflow_id = self._workflow_id

            if self._triggered_from is not None:
                execution.triggered_from = self._triggered_from

            if self._created_by_role is not None:
                execution.created_by_role = self._created_by_role

            if self._created_by is not None:
                execution.created_by = self._created_by

            session.merge(execution)
            session.commit()

    def update_context(
        self,
        app_id: str | None = None,
        workflow_id: str | None = None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None = None,
        created_by_role: str | None = None,
        created_by: str | None = None,
    ) -> None:
        """
        Update the repository's context parameters.

        This method allows updating the repository's context parameters after initialization.
        Only parameters that are not None will be updated.

        Args:
            app_id: New app ID for filtering
            workflow_id: New workflow ID for filtering
            triggered_from: New triggered_from value (WorkflowNodeExecutionTriggeredFrom enum)
            created_by_role: New creator role
            created_by: New creator ID
        """
        if app_id is not None:
            self._app_id = app_id
        if workflow_id is not None:
            self._workflow_id = workflow_id
        if triggered_from is not None:
            self._triggered_from = triggered_from
        if created_by_role is not None:
            self._created_by_role = created_by_role
        if created_by is not None:
            self._created_by = created_by

    def clear(self) -> None:
        """
        Clear all WorkflowNodeExecution records for the current tenant_id and other filters.

        This method deletes all WorkflowNodeExecution records that match the tenant_id
        and other filters (app_id, workflow_id, triggered_from) associated with this repository instance.
        """
        with self._session_factory() as session:
            stmt = delete(WorkflowNodeExecution).where(WorkflowNodeExecution.tenant_id == self._tenant_id)

            # Apply additional filters if provided
            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            if self._workflow_id:
                stmt = stmt.where(WorkflowNodeExecution.workflow_id == self._workflow_id)

            if self._triggered_from:
                stmt = stmt.where(WorkflowNodeExecution.triggered_from == self._triggered_from)

            result = session.execute(stmt)
            session.commit()

            # Build log message with all applied filters
            filter_parts = []
            if self._tenant_id:
                filter_parts.append(f"tenant {self._tenant_id}")
            if self._app_id:
                filter_parts.append(f"app {self._app_id}")

            if self._workflow_id:
                filter_parts.append(f"workflow {self._workflow_id}")

            if self._triggered_from:
                filter_parts.append(f"triggered_from {self._triggered_from}")

            filters_str = " and ".join(filter_parts)
            deleted_count = result.rowcount
            logger.info(f"Cleared {deleted_count} workflow node execution records for {filters_str}")
