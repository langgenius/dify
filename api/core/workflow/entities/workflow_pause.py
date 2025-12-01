"""
Domain entities for workflow pause management.

This module contains the domain model for workflow pause, which is used
by the core workflow module. These models are independent of the storage mechanism
and don't contain implementation details like tenant_id, app_id, etc.
"""

from abc import ABC, abstractmethod
from datetime import datetime


class WorkflowPauseEntity(ABC):
    """
    Abstract base class for workflow pause entities.

    This domain model represents a paused workflow execution state,
    without implementation details like tenant_id, app_id, etc.
    It provides the interface for managing workflow pause/resume operations
    and state persistence through file storage.

    The `WorkflowPauseEntity` is never reused. If a workflow execution pauses multiple times,
    it will generate multiple `WorkflowPauseEntity` records.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """The identifier of current WorkflowPauseEntity"""
        pass

    @property
    @abstractmethod
    def workflow_execution_id(self) -> str:
        """The identifier of the workflow execution record the pause associated with.
        Correspond to `WorkflowExecution.id`.
        """

    @abstractmethod
    def get_state(self) -> bytes:
        """
        Retrieve the serialized workflow state from storage.

        This method should load and return the workflow execution state
        that was saved when the workflow was paused. The state contains
        all necessary information to resume the workflow execution.

        Returns:
            bytes: The serialized workflow state containing
            execution context, variable values, node states, etc.

        """
        ...

    @property
    @abstractmethod
    def resumed_at(self) -> datetime | None:
        """`resumed_at` return the resumption time of the current pause, or `None` if
        the pause is not resumed yet.
        """
        pass
