"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

import json
import logging
from collections.abc import Sequence
from typing import Optional, Union

from sqlalchemy import UnaryExpression, asc, delete, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.node_execution_entities import (
    NodeExecution,
    NodeExecutionStatus,
)
from core.workflow.repository.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository
from models import (
    Account,
    CreatedByRole,
    EndUser,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
)

logger = logging.getLogger(__name__)


class SQLAlchemyWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.

    This implementation also includes an in-memory cache for node executions to improve
    performance by reducing database queries.
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: Optional[str] = None,
        triggered_from: Optional[WorkflowNodeExecutionTriggeredFrom] = None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: Optional app ID for filtering by application
            triggered_from: Source of the execution trigger (single-step or workflow-run)
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

        # Extract tenant_id from user
        tenant_id: str | None = user.tenant_id if isinstance(user, EndUser) else user.current_tenant_id
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._created_by = user.id

        # Determine user role based on user type
        self._created_by_role = CreatedByRole.ACCOUNT if isinstance(user, Account) else CreatedByRole.END_USER

        # Initialize in-memory cache for node executions
        # Key: node_execution_id, Value: NodeExecution
        self._node_execution_cache: dict[str, NodeExecution] = {}

    def _to_domain_model(self, db_model: WorkflowNodeExecution) -> NodeExecution:
        """
        Convert a database model to a domain model.

        Args:
            db_model: The database model to convert

        Returns:
            The domain model
        """
        # Parse JSON fields
        inputs = json.loads(db_model.inputs) if db_model.inputs else None
        process_data = json.loads(db_model.process_data) if db_model.process_data else None
        outputs = json.loads(db_model.outputs) if db_model.outputs else None
        metadata = json.loads(db_model.execution_metadata) if db_model.execution_metadata else None

        # Convert status to domain enum
        status = NodeExecutionStatus(db_model.status)

        return NodeExecution(
            id=db_model.id,
            node_execution_id=db_model.node_execution_id,
            workflow_id=db_model.workflow_id,
            workflow_run_id=db_model.workflow_run_id,
            index=db_model.index,
            predecessor_node_id=db_model.predecessor_node_id,
            node_id=db_model.node_id,
            node_type=db_model.node_type,
            title=db_model.title,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            status=status,
            error=db_model.error,
            elapsed_time=db_model.elapsed_time,
            metadata=metadata,
            created_at=db_model.created_at,
            finished_at=db_model.finished_at,
        )

    def _to_db_model(self, domain_model: NodeExecution) -> WorkflowNodeExecution:
        """
        Convert a domain model to a database model.

        Args:
            domain_model: The domain model to convert

        Returns:
            The database model
        """
        # Use values from constructor if provided
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._created_by:
            raise ValueError("created_by is required in repository constructor")
        if not self._created_by_role:
            raise ValueError("created_by_role is required in repository constructor")

        db_model = WorkflowNodeExecution()
        db_model.id = domain_model.id
        db_model.tenant_id = self._tenant_id
        if self._app_id is not None:
            db_model.app_id = self._app_id
        db_model.workflow_id = domain_model.workflow_id
        db_model.triggered_from = self._triggered_from
        db_model.workflow_run_id = domain_model.workflow_run_id
        db_model.index = domain_model.index
        db_model.predecessor_node_id = domain_model.predecessor_node_id
        db_model.node_execution_id = domain_model.node_execution_id
        db_model.node_id = domain_model.node_id
        db_model.node_type = domain_model.node_type
        db_model.title = domain_model.title
        db_model.inputs = json.dumps(domain_model.inputs) if domain_model.inputs else None
        db_model.process_data = json.dumps(domain_model.process_data) if domain_model.process_data else None
        db_model.outputs = json.dumps(domain_model.outputs) if domain_model.outputs else None
        db_model.status = domain_model.status
        db_model.error = domain_model.error
        db_model.elapsed_time = domain_model.elapsed_time
        db_model.execution_metadata = json.dumps(domain_model.metadata) if domain_model.metadata else None
        db_model.created_at = domain_model.created_at
        db_model.created_by_role = self._created_by_role
        db_model.created_by = self._created_by
        db_model.finished_at = domain_model.finished_at
        return db_model

    def save(self, execution: NodeExecution) -> None:
        """
        Save or update a NodeExecution instance and commit changes to the database.

        This method handles both creating new records and updating existing ones.
        It determines whether to create or update based on whether the record
        already exists in the database. It also updates the in-memory cache.

        Args:
            execution: The NodeExecution instance to save or update
        """
        with self._session_factory() as session:
            # Convert domain model to database model using instance attributes
            db_model = self._to_db_model(execution)

            # Use merge which will handle both insert and update
            session.merge(db_model)
            session.commit()

            # Update the cache if node_execution_id is present
            if execution.node_execution_id:
                logger.debug(f"Updating cache for node_execution_id: {execution.node_execution_id}")
                self._node_execution_cache[execution.node_execution_id] = execution

    def get_by_node_execution_id(self, node_execution_id: str) -> Optional[NodeExecution]:
        """
        Retrieve a NodeExecution by its node_execution_id.

        First checks the in-memory cache, and if not found, queries the database.
        If found in the database, adds it to the cache for future lookups.

        Args:
            node_execution_id: The node execution ID

        Returns:
            The NodeExecution instance if found, None otherwise
        """
        # First check the cache
        if node_execution_id in self._node_execution_cache:
            logger.debug(f"Cache hit for node_execution_id: {node_execution_id}")
            return self._node_execution_cache[node_execution_id]

        # If not in cache, query the database
        logger.debug(f"Cache miss for node_execution_id: {node_execution_id}, querying database")
        with self._session_factory() as session:
            stmt = select(WorkflowNodeExecution).where(
                WorkflowNodeExecution.node_execution_id == node_execution_id,
                WorkflowNodeExecution.tenant_id == self._tenant_id,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecution.app_id == self._app_id)

            db_model = session.scalar(stmt)
            if db_model:
                # Convert to domain model
                domain_model = self._to_domain_model(db_model)

                # Add to cache
                self._node_execution_cache[node_execution_id] = domain_model

                return domain_model

            return None

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[NodeExecution]:
        """
        Retrieve all NodeExecution instances for a specific workflow run.

        This method always queries the database to ensure complete and ordered results,
        but updates the cache with any retrieved executions.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of NodeExecution instances
        """
        # Get the raw database models using the new method
        db_models = self.get_db_models_by_workflow_run(workflow_run_id, order_config)

        # Convert database models to domain models and update cache
        domain_models = []
        for model in db_models:
            domain_model = self._to_domain_model(model)
            # Update cache if node_execution_id is present
            if domain_model.node_execution_id:
                self._node_execution_cache[domain_model.node_execution_id] = domain_model
            domain_models.append(domain_model)

        return domain_models

    def get_db_models_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution database models for a specific workflow run.

        This method is similar to get_by_workflow_run but returns the raw database models
        instead of converting them to domain models. This can be useful when direct access
        to database model properties is needed.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution database models
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

            db_models = session.scalars(stmt).all()

            # Note: We don't update the cache here since we're returning raw DB models
            # and not converting to domain models

            return db_models

    def get_running_executions(self, workflow_run_id: str) -> Sequence[NodeExecution]:
        """
        Retrieve all running NodeExecution instances for a specific workflow run.

        This method queries the database directly and updates the cache with any
        retrieved executions that have a node_execution_id.

        Args:
            workflow_run_id: The workflow run ID

        Returns:
            A list of running NodeExecution instances
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

            db_models = session.scalars(stmt).all()
            domain_models = []

            for model in db_models:
                domain_model = self._to_domain_model(model)
                # Update cache if node_execution_id is present
                if domain_model.node_execution_id:
                    self._node_execution_cache[domain_model.node_execution_id] = domain_model
                domain_models.append(domain_model)

            return domain_models

    def clear(self) -> None:
        """
        Clear all WorkflowNodeExecution records for the current tenant_id and app_id.

        This method deletes all WorkflowNodeExecution records that match the tenant_id
        and app_id (if provided) associated with this repository instance.
        It also clears the in-memory cache.
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

            # Clear the in-memory cache
            self._node_execution_cache.clear()
            logger.info("Cleared in-memory node execution cache")
