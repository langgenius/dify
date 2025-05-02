from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Optional, Protocol

from models.workflow import WorkflowNodeExecution


@dataclass
class OrderConfig:
    """Configuration for ordering WorkflowNodeExecution instances."""

    order_by: list[str]
    order_direction: Optional[Literal["asc", "desc"]] = None


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

    def clear(self) -> None:
        """
        Clear all WorkflowNodeExecution records based on implementation-specific criteria.

        This method is intended to be used for bulk deletion operations, such as removing
        all records associated with a specific app_id and tenant_id in multi-tenant implementations.
        """
        ...
