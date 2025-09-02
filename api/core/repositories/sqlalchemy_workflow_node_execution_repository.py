"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

import json
import logging
from collections.abc import Sequence
from typing import Optional, Union

import psycopg2.errors
from sqlalchemy import UnaryExpression, asc, desc, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt

from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.nodes.enums import NodeType
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.helper import extract_tenant_id
from libs.uuid_utils import uuidv7
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionModel,
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
        app_id: Optional[str],
        triggered_from: Optional[WorkflowNodeExecutionTriggeredFrom],
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
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
        tenant_id = extract_tenant_id(user)
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # Initialize in-memory cache for node executions
        # Key: node_execution_id, Value: WorkflowNodeExecution (DB model)
        self._node_execution_cache: dict[str, WorkflowNodeExecutionModel] = {}

    def _to_domain_model(self, db_model: WorkflowNodeExecutionModel) -> WorkflowNodeExecution:
        """
        Convert a database model to a domain model.

        Args:
            db_model: The database model to convert

        Returns:
            The domain model
        """
        # Parse JSON fields
        inputs = db_model.inputs_dict
        process_data = db_model.process_data_dict
        outputs = db_model.outputs_dict
        metadata = {WorkflowNodeExecutionMetadataKey(k): v for k, v in db_model.execution_metadata_dict.items()}

        # Convert status to domain enum
        status = WorkflowNodeExecutionStatus(db_model.status)

        return WorkflowNodeExecution(
            id=db_model.id,
            node_execution_id=db_model.node_execution_id,
            workflow_id=db_model.workflow_id,
            workflow_execution_id=db_model.workflow_run_id,
            index=db_model.index,
            predecessor_node_id=db_model.predecessor_node_id,
            node_id=db_model.node_id,
            node_type=NodeType(db_model.node_type),
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

    def to_db_model(self, domain_model: WorkflowNodeExecution) -> WorkflowNodeExecutionModel:
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
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        json_converter = WorkflowRuntimeTypeConverter()
        db_model = WorkflowNodeExecutionModel()
        db_model.id = domain_model.id
        db_model.tenant_id = self._tenant_id
        if self._app_id is not None:
            db_model.app_id = self._app_id
        db_model.workflow_id = domain_model.workflow_id
        db_model.triggered_from = self._triggered_from
        db_model.workflow_run_id = domain_model.workflow_execution_id
        db_model.index = domain_model.index
        db_model.predecessor_node_id = domain_model.predecessor_node_id
        db_model.node_execution_id = domain_model.node_execution_id
        db_model.node_id = domain_model.node_id
        db_model.node_type = domain_model.node_type
        db_model.title = domain_model.title
        db_model.inputs = (
            json.dumps(json_converter.to_json_encodable(domain_model.inputs)) if domain_model.inputs else None
        )
        db_model.process_data = (
            json.dumps(json_converter.to_json_encodable(domain_model.process_data))
            if domain_model.process_data
            else None
        )
        db_model.outputs = (
            json.dumps(json_converter.to_json_encodable(domain_model.outputs)) if domain_model.outputs else None
        )
        db_model.status = domain_model.status
        db_model.error = domain_model.error
        db_model.elapsed_time = domain_model.elapsed_time
        db_model.execution_metadata = (
            json.dumps(jsonable_encoder(domain_model.metadata)) if domain_model.metadata else None
        )
        db_model.created_at = domain_model.created_at
        db_model.created_by_role = self._creator_user_role
        db_model.created_by = self._creator_user_id
        db_model.finished_at = domain_model.finished_at
        return db_model

    def _is_duplicate_key_error(self, exception: BaseException) -> bool:
        """Check if the exception is a duplicate key constraint violation."""
        return isinstance(exception, IntegrityError) and isinstance(exception.orig, psycopg2.errors.UniqueViolation)

    def _regenerate_id_on_duplicate(
        self, execution: WorkflowNodeExecution, db_model: WorkflowNodeExecutionModel
    ) -> None:
        """Regenerate UUID v7 for both domain and database models when duplicate key detected."""
        new_id = str(uuidv7())
        logger.warning(
            "Duplicate key conflict for workflow node execution ID %s, generating new UUID v7: %s", db_model.id, new_id
        )
        db_model.id = new_id
        execution.id = new_id

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a NodeExecution domain entity to the database.

        This method serves as a domain-to-database adapter that:
        1. Converts the domain entity to its database representation
        2. Checks for existing records and updates or inserts accordingly
        3. Maintains proper multi-tenancy by including tenant context during conversion
        4. Updates the in-memory cache for faster subsequent lookups
        5. Handles duplicate key conflicts by retrying with a new UUID v7

        Args:
            execution: The NodeExecution domain entity to persist
        """
        # Convert domain model to database model using tenant context and other attributes
        db_model = self.to_db_model(execution)

        # Use tenacity for retry logic with duplicate key handling
        @retry(
            stop=stop_after_attempt(3),
            retry=retry_if_exception(self._is_duplicate_key_error),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        def _save_with_retry():
            try:
                self._persist_to_database(db_model)
            except IntegrityError as e:
                if self._is_duplicate_key_error(e):
                    # Generate new UUID and retry
                    self._regenerate_id_on_duplicate(execution, db_model)
                    raise  # Let tenacity handle the retry
                else:
                    # Different integrity error, don't retry
                    logger.exception("Non-duplicate key integrity error while saving workflow node execution")
                    raise

        try:
            _save_with_retry()

            # Update the in-memory cache after successful save
            if db_model.node_execution_id:
                logger.debug("Updating cache for node_execution_id: %s", db_model.node_execution_id)
                self._node_execution_cache[db_model.node_execution_id] = db_model

        except Exception as e:
            logger.exception("Failed to save workflow node execution after all retries")
            raise

    def _persist_to_database(self, db_model: WorkflowNodeExecutionModel) -> None:
        """
        Persist the database model to the database.

        Checks if a record with the same ID exists and either updates it or creates a new one.

        Args:
            db_model: The database model to persist
        """
        with self._session_factory() as session:
            # Check if record already exists
            existing = session.get(WorkflowNodeExecutionModel, db_model.id)

            if existing:
                # Update existing record by copying all non-private attributes
                for key, value in db_model.__dict__.items():
                    if not key.startswith("_"):
                        setattr(existing, key, value)
            else:
                # Add new record
                session.add(db_model)

            session.commit()

    def get_db_models_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Retrieve all WorkflowNodeExecution database models for a specific workflow run.

        This method directly returns database models without converting to domain models,
        which is useful when you need to access database-specific fields like triggered_from.
        It also updates the in-memory cache with the retrieved models.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution database models
        """
        with self._session_factory() as session:
            stmt = select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                WorkflowNodeExecutionModel.tenant_id == self._tenant_id,
                WorkflowNodeExecutionModel.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            if self._app_id:
                stmt = stmt.where(WorkflowNodeExecutionModel.app_id == self._app_id)

            # Apply ordering if provided
            if order_config and order_config.order_by:
                order_columns: list[UnaryExpression] = []
                for field in order_config.order_by:
                    column = getattr(WorkflowNodeExecutionModel, field, None)
                    if not column:
                        continue
                    if order_config.order_direction == "desc":
                        order_columns.append(desc(column))
                    else:
                        order_columns.append(asc(column))

                if order_columns:
                    stmt = stmt.order_by(*order_columns)

            db_models = session.scalars(stmt).all()

            # Update the cache with the retrieved DB models
            for model in db_models:
                if model.node_execution_id:
                    self._node_execution_cache[model.node_execution_id] = model

            return db_models

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
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
        # Get the database models using the new method
        db_models = self.get_db_models_by_workflow_run(workflow_run_id, order_config)

        # Convert database models to domain models
        domain_models = []
        for model in db_models:
            domain_model = self._to_domain_model(model)
            domain_models.append(domain_model)

        return domain_models
