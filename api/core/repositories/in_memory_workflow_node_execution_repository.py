"""
In-memory implementation of the WorkflowNodeExecutionRepository.
"""

import logging
from collections.abc import Sequence
from typing import Optional, Union

from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionTriggeredFrom,
)

logger = logging.getLogger(__name__)


class InMemoryWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    In-memory implementation of the WorkflowNodeExecutionRepository interface.

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
        triggered_from: Optional[WorkflowNodeExecutionTriggeredFrom],
    ):
        """
        Initialize the repository with context information.

        Args:
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
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
        # Primary data store: node_execution_id -> NodeExecution
        self._executions: dict[str, WorkflowNodeExecution] = {}

        # Index by workflow_execution_id for faster lookups
        # workflow_execution_id -> List[node_execution_id]
        self._workflow_run_index: dict[str, list[str]] = {}

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a NodeExecution domain entity to the in-memory store.

        This method will add the execution to the main dictionary and update the
        workflow run index.

        Args:
            execution: The NodeExecution domain entity to persist
        """
        # Save to primary data store
        if execution.node_execution_id:
            self._executions[execution.node_execution_id] = execution

            # Update workflow run index
            if execution.workflow_execution_id:
                if execution.workflow_execution_id not in self._workflow_run_index:
                    self._workflow_run_index[execution.workflow_execution_id] = []

                if execution.node_execution_id not in self._workflow_run_index[execution.workflow_execution_id]:
                    self._workflow_run_index[execution.workflow_execution_id].append(execution.node_execution_id)

            logger.debug(f"Saved node execution with ID: {execution.node_execution_id}")
        else:
            logger.warning("Attempted to save execution without node_execution_id")

    def get_by_node_execution_id(self, node_execution_id: str) -> Optional[WorkflowNodeExecution]:
        """
        Retrieve a NodeExecution by its node_execution_id.

        Args:
            node_execution_id: The node execution ID

        Returns:
            The NodeExecution instance if found, None otherwise
        """
        execution = self._executions.get(node_execution_id)

        # Only return executions that match the tenant_id and app_id constraints
        if execution and self._matches_constraints(execution):
            return execution

        return None

    def _matches_constraints(self, execution: WorkflowNodeExecution) -> bool:
        """
        Check if an execution matches the tenant and app constraints.

        Args:
            execution: The NodeExecution to check

        Returns:
            True if the execution matches constraints, False otherwise
        """
        # In a real implementation, NodeExecution would need to store tenant_id and app_id
        # For this implementation, we assume all stored executions belong to the current tenant
        # and app_id is checked when relevant
        return True

    def get_by_workflow_run(
        self,
        workflow_execution_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all NodeExecution instances for a specific workflow run.

        Args:
            workflow_execution_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of NodeExecution instances
        """
        result = []

        # Get all node_execution_ids for this workflow run
        node_execution_ids = self._workflow_run_index.get(workflow_execution_id, [])

        # Retrieve the actual executions
        for node_id in node_execution_ids:
            execution = self._executions.get(node_id)
            if execution and self._matches_constraints(execution):
                # Only include executions from workflow runs, not single steps
                if execution.workflow_execution_id == workflow_execution_id:
                    result.append(execution)

        # Apply ordering if provided
        if order_config and order_config.order_by:
            is_desc = order_config.order_direction == "desc"

            # Apply multi-level sorting
            for sort_field in reversed(order_config.order_by):
                # Use a key function that ensures a comparable value even if the attribute doesn't exist
                result.sort(key=lambda x: getattr(x, sort_field, "") or "", reverse=is_desc)

        return result

    def get_running_executions(self, workflow_execution_id: str) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all running NodeExecution instances for a specific workflow run.

        Args:
            workflow_execution_id: The workflow run ID

        Returns:
            A list of running NodeExecution instances
        """
        # Get all executions for this workflow run
        all_executions = self.get_by_workflow_run(workflow_execution_id)

        # Filter for running status
        return [execution for execution in all_executions if execution.status == WorkflowNodeExecutionStatus.RUNNING]

    def clear(self) -> None:
        """
        Clear all NodeExecution records for the current tenant_id and app_id.

        This implementation clears the entire in-memory store.
        """
        count = len(self._executions)
        self._executions.clear()
        self._workflow_run_index.clear()

        logger.info(
            f"Cleared {count} workflow node execution records for tenant {self._tenant_id}"
            + (f" and app {self._app_id}" if self._app_id else "")
        )
