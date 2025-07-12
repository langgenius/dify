"""
In-memory implementation of the WorkflowExecutionRepository.
"""

import logging
from typing import Optional, Union

from core.workflow.entities.workflow_execution import (
    WorkflowExecution,
)
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from models import (
    Account,
    CreatorUserRole,
    EndUser,
)
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


class InMemoryWorkflowExecutionRepository(WorkflowExecutionRepository):
    """
    In-memory implementation of the WorkflowExecutionRepository interface.

    This implementation stores all data in memory rather than a database,
    making it useful for testing, development, or situations where persistence
    is not required or where performance is critical.

    Like the SQLAlchemy implementation, it supports multi-tenancy by filtering
    operations based on tenant_id.
    """

    def __init__(
        self,
        user: Union[Account, EndUser],
        app_id: Optional[str],
        triggered_from: Optional[WorkflowRunTriggeredFrom],
    ):
        """
        Initialize the repository with context information.

        Args:
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
        """
        # Extract tenant_id from user
        tenant_id: str | None = user.tenant_id if isinstance(user, EndUser) else user.current_tenant_id
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

        # In-memory storage using dictionaries
        # Primary data store: execution_id -> WorkflowExecution
        self._executions: dict[str, WorkflowExecution] = {}

        # Sequence counter for app/tenant
        self._sequence_counters: dict[tuple[str, str], int] = {}

    def save(self, execution: WorkflowExecution) -> None:
        """
        Save or update a WorkflowExecution domain entity to the in-memory store.

        Args:
            execution: The WorkflowExecution domain entity to persist
        """
        if execution.id_:
            # Store the execution in the in-memory dictionary
            self._executions[execution.id_] = execution
            logger.debug(f"Saved workflow execution with ID: {execution.id_}")
        else:
            logger.warning("Attempted to save execution without id_")

    def get(self, execution_id: str) -> Optional[WorkflowExecution]:
        """
        Retrieve a WorkflowExecution by its ID.

        Args:
            execution_id: The workflow execution ID

        Returns:
            The WorkflowExecution instance if found, None otherwise
        """
        execution = self._executions.get(execution_id)

        # Only return executions that match the tenant_id and app_id constraints
        if execution and self._matches_constraints(execution):
            return execution

        return None

    def _matches_constraints(self, execution: WorkflowExecution) -> bool:
        """
        Check if an execution matches the tenant and app constraints.

        In the in-memory implementation, we assume all stored executions
        belong to the current tenant and we don't do explicit tenant filtering.

        Args:
            execution: The WorkflowExecution to check

        Returns:
            True if the execution matches constraints, False otherwise
        """
        # For in-memory implementation, we assume it matches
        return True
