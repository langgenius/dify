from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Optional

from models.workflow import WorkflowNodeExecution


class WorkflowNodeExecutionRepository(ABC):
    """
    Repository interface for WorkflowNodeExecution.

    This interface defines the contract for accessing and manipulating
    WorkflowNodeExecution data, regardless of the underlying storage mechanism.

    Note: Tenant ID and other contextual information should be handled at the
    implementation level, not in the core interface.
    """

    @abstractmethod
    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save a WorkflowNodeExecution instance.

        Args:
            execution: The WorkflowNodeExecution instance to save
        """
        pass

    @abstractmethod
    def get_by_id(self, execution_id: str) -> Optional[WorkflowNodeExecution]:
        """
        Retrieve a WorkflowNodeExecution by its ID.

        Args:
            execution_id: The execution ID

        Returns:
            The WorkflowNodeExecution instance if found, None otherwise
        """
        pass

    @abstractmethod
    def get_by_workflow_run(
        self, app_id: str, workflow_id: str, triggered_from: str, workflow_run_id: str
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run.

        Args:
            app_id: The app ID
            workflow_id: The workflow ID
            triggered_from: The trigger source
            workflow_run_id: The workflow run ID

        Returns:
            A list of WorkflowNodeExecution instances
        """
        pass

    @abstractmethod
    def update(self, execution: WorkflowNodeExecution) -> None:
        """
        Update an existing WorkflowNodeExecution instance.

        Args:
            execution: The WorkflowNodeExecution instance to update
        """
        pass

    @abstractmethod
    def delete(self, execution_id: str) -> None:
        """
        Delete a WorkflowNodeExecution by its ID.

        Args:
            execution_id: The execution ID
        """
        pass
