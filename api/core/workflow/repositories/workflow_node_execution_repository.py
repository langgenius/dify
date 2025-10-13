from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from core.workflow.entities import WorkflowNodeExecution


@dataclass
class OrderConfig:
    """Configuration for ordering NodeExecution instances."""

    order_by: list[str]
    order_direction: Literal["asc", "desc"] | None = None


class WorkflowNodeExecutionRepository(Protocol):
    """
    Repository interface for NodeExecution.

    This interface defines the contract for accessing and manipulating
    NodeExecution data, regardless of the underlying storage mechanism.

    Note: Domain-specific concepts like multi-tenancy (tenant_id), application context (app_id),
    and trigger sources (triggered_from) should be handled at the implementation level, not in
    the core interface. This keeps the core domain model clean and independent of specific
    application domains or deployment scenarios.
    """

    def save(self, execution: WorkflowNodeExecution):
        """
        Save or update a NodeExecution instance.

        This method saves all data on the `WorkflowNodeExecution` object, except for `inputs`, `process_data`,
        and `outputs`. Its primary purpose is to persist the status and various metadata, such as execution time
        and execution-related details.

        It's main purpose is to save the status and various metadata (execution time, execution metadata etc.)

        This method handles both creating new records and updating existing ones.
        The implementation should determine whether to create or update based on
        the execution's ID or other identifying fields.

        Args:
            execution: The NodeExecution instance to save or update
        """
        ...

    def save_execution_data(self, execution: WorkflowNodeExecution):
        """Save or update the inputs, process_data, or outputs associated with a specific
        node_execution record.

        If any of the inputs, process_data, or outputs are None, those fields will not be updated.
        """
        ...

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all NodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of NodeExecution instances
        """
        ...
