"""
SQLAlchemy implementation of the WorkflowExecutionRepository.
"""

import json
import logging
from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities import WorkflowExecution
from core.workflow.enums import WorkflowExecutionStatus, WorkflowType
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.helper import extract_tenant_id
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowRun,
)
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


class SQLAlchemyWorkflowExecutionRepository(WorkflowExecutionRepository):
    """
    SQLAlchemy implementation of the WorkflowExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.

    This implementation also includes an in-memory cache for workflow executions to improve
    performance by reducing database queries.
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowRunTriggeredFrom | None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
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

        # Initialize in-memory cache for workflow executions
        # Key: execution_id, Value: WorkflowRun (DB model)
        self._execution_cache: dict[str, WorkflowRun] = {}

    def _to_domain_model(self, db_model: WorkflowRun) -> WorkflowExecution:
        """
        Convert a database model to a domain model.

        Args:
            db_model: The database model to convert

        Returns:
            The domain model
        """
        # Parse JSON fields
        inputs = db_model.inputs_dict
        outputs = db_model.outputs_dict
        graph = db_model.graph_dict

        # Convert status to domain enum
        status = WorkflowExecutionStatus(db_model.status)

        return WorkflowExecution(
            id_=db_model.id,
            workflow_id=db_model.workflow_id,
            workflow_type=WorkflowType(db_model.type),
            workflow_version=db_model.version,
            graph=graph,
            inputs=inputs,
            outputs=outputs,
            status=status,
            error_message=db_model.error or "",
            total_tokens=db_model.total_tokens,
            total_steps=db_model.total_steps,
            exceptions_count=db_model.exceptions_count,
            started_at=db_model.created_at,
            finished_at=db_model.finished_at,
        )

    def _to_db_model(self, domain_model: WorkflowExecution) -> WorkflowRun:
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

        db_model = WorkflowRun()
        db_model.id = domain_model.id_
        db_model.tenant_id = self._tenant_id
        if self._app_id is not None:
            db_model.app_id = self._app_id
        db_model.workflow_id = domain_model.workflow_id
        db_model.triggered_from = self._triggered_from

        # No sequence number generation needed anymore

        db_model.type = domain_model.workflow_type
        db_model.version = domain_model.workflow_version
        db_model.graph = json.dumps(domain_model.graph) if domain_model.graph else None
        db_model.inputs = json.dumps(domain_model.inputs) if domain_model.inputs else None
        db_model.outputs = (
            json.dumps(WorkflowRuntimeTypeConverter().to_json_encodable(domain_model.outputs))
            if domain_model.outputs
            else None
        )
        db_model.status = domain_model.status
        db_model.error = domain_model.error_message or None
        db_model.total_tokens = domain_model.total_tokens
        db_model.total_steps = domain_model.total_steps
        db_model.exceptions_count = domain_model.exceptions_count
        db_model.created_by_role = self._creator_user_role
        db_model.created_by = self._creator_user_id
        db_model.created_at = domain_model.started_at
        db_model.finished_at = domain_model.finished_at

        # Calculate elapsed time if finished_at is available
        if domain_model.finished_at:
            db_model.elapsed_time = (domain_model.finished_at - domain_model.started_at).total_seconds()
        else:
            db_model.elapsed_time = 0

        return db_model

    def save(self, execution: WorkflowExecution):
        """
        Save or update a WorkflowExecution domain entity to the database.

        This method serves as a domain-to-database adapter that:
        1. Converts the domain entity to its database representation
        2. Persists the database model using SQLAlchemy's merge operation
        3. Maintains proper multi-tenancy by including tenant context during conversion
        4. Updates the in-memory cache for faster subsequent lookups

        The method handles both creating new records and updating existing ones through
        SQLAlchemy's merge operation.

        Args:
            execution: The WorkflowExecution domain entity to persist
        """
        # Convert domain model to database model using tenant context and other attributes
        db_model = self._to_db_model(execution)

        # Create a new database session
        with self._session_factory() as session:
            # SQLAlchemy merge intelligently handles both insert and update operations
            # based on the presence of the primary key
            session.merge(db_model)
            session.commit()

            # Update the in-memory cache for faster subsequent lookups
            self._execution_cache[db_model.id] = db_model
