"""Compatibility aliases for workflow execution service contracts."""

from services.workflow.execution.contracts import PreparedWorkflowRun, WorkflowRunDriver, WorkflowRunRunner

WorkflowBasedAppRunner = WorkflowRunRunner

__all__ = [
    "PreparedWorkflowRun",
    "WorkflowBasedAppRunner",
    "WorkflowRunDriver",
]
