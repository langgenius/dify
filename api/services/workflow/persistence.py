"""Persistence contracts consumed by workflow execution services."""

from collections.abc import Sequence
from typing import Protocol

from graphon.entities import WorkflowExecution, WorkflowNodeExecution


class WorkflowExecutionRepository(Protocol):
    def save(self, execution: WorkflowExecution) -> None: ...

    def save_synchronously(self, execution: WorkflowExecution) -> None:
        """Commit the SQL control record before publishing a lifecycle transition."""
        ...


class WorkflowNodeExecutionRepository(Protocol):
    def for_workflow_tool(self, app_id: str) -> "WorkflowNodeExecutionRepository":
        """Scope hidden Workflow Tool executions to their source app in the same tenant."""
        ...

    def save(self, execution: WorkflowNodeExecution) -> None: ...

    def save_many(self, executions: Sequence[WorkflowNodeExecution]) -> None:
        """Save exact records in this owner scope without uploading execution data."""
        ...

    def save_synchronously(self, execution: WorkflowNodeExecution) -> None: ...

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None: ...

    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        *,
        include_paused: bool = False,
    ) -> Sequence[WorkflowNodeExecution]:
        """Read executions in this repository's app/origin scope, optionally including paused nodes."""
        ...
