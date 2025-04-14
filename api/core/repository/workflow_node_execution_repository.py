from collections.abc import Sequence
from datetime import datetime
from typing import Literal, Optional, Protocol, TypedDict

from models.workflow import WorkflowNodeExecution


class WorkflowNodeExecutionCriteria(TypedDict, total=False):
    """Criteria for filtering WorkflowNodeExecution instances."""

    workflow_run_id: str
    node_execution_id: str
    created_at_before: datetime
    created_at_after: datetime
    status: str


class WorkflowNodeExecutionRepository(Protocol):
    """
    Repository interface for WorkflowNodeExecution.

    This interface defines the contract for accessing and manipulating
    WorkflowNodeExecution data, regardless of the underlying storage mechanism.

    Note: Domain-specific concepts like multi-tenancy (tenant_id), application context (app_id),
    and trigger sources (triggered_from) should be handled at the implementation level, not in
    the core interface. This keeps the core domain model clean and independent of specific
    application domains or deployment scenarios.
    """

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save a WorkflowNodeExecution instance.

        Args:
            execution: The WorkflowNodeExecution instance to save
        """
        ...

    # Method get_by_id was removed as it's not used anywhere in the codebase

    def get_by_node_execution_id(self, node_execution_id: str) -> Optional[WorkflowNodeExecution]:
        """
        Retrieve a WorkflowNodeExecution by its node_execution_id.

        Args:
            node_execution_id: The node execution ID

        Returns:
            The WorkflowNodeExecution instance if found, None otherwise
        """
        ...

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_by: Optional[str] = None,
        order_direction: Optional[Literal["asc", "desc"]] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID
            order_by: Optional field to order by (e.g., "index", "created_at")
            order_direction: Optional direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution instances
        """
        ...

    def get_running_executions(self, workflow_run_id: str) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all running WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID

        Returns:
            A list of running WorkflowNodeExecution instances
        """
        ...

    def update(self, execution: WorkflowNodeExecution) -> None:
        """
        Update an existing WorkflowNodeExecution instance.

        Args:
            execution: The WorkflowNodeExecution instance to update
        """
        ...

    def delete(self, execution_id: str) -> None:
        """
        Delete a WorkflowNodeExecution by its ID.

        Args:
            execution_id: The execution ID
        """
        ...

    # Method delete_by_criteria was removed as it's not used anywhere in the codebase

    def find_by_criteria(
        self,
        criteria: WorkflowNodeExecutionCriteria,
        order_by: Optional[str] = None,
        order_direction: Optional[Literal["asc", "desc"]] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Find WorkflowNodeExecution instances matching the given criteria.

        Args:
            criteria: Dictionary of criteria to match
            order_by: Optional field to order by
            order_direction: Optional direction to order ("asc" or "desc")
            limit: Optional limit on the number of results
            offset: Optional offset for pagination

        Returns:
            A list of matching WorkflowNodeExecution instances
        """
        ...
