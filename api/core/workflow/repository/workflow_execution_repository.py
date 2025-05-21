from typing import Optional, Protocol

from core.workflow.entities.workflow_execution_entities import WorkflowExecution


class WorkflowExecutionRepository(Protocol):
    """
    Repository interface for WorkflowExecution.

    This interface defines the contract for accessing and manipulating
    WorkflowExecution data, regardless of the underlying storage mechanism.

    Note: Domain-specific concepts like multi-tenancy (tenant_id), application context (app_id),
    and other implementation details should be handled at the implementation level, not in
    the core interface. This keeps the core domain model clean and independent of specific
    application domains or deployment scenarios.
    """

    def save(self, execution: WorkflowExecution) -> None:
        """
        Save or update a WorkflowExecution instance.

        This method handles both creating new records and updating existing ones.
        The implementation should determine whether to create or update based on
        the execution's ID or other identifying fields.

        Args:
            execution: The WorkflowExecution instance to save or update
        """
        ...

    def get(self, execution_id: str) -> Optional[WorkflowExecution]:
        """
        Retrieve a WorkflowExecution by its ID.

        Args:
            execution_id: The workflow execution ID

        Returns:
            The WorkflowExecution instance if found, None otherwise
        """
        ...
