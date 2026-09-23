"""Dify persistence identity alongside Graphon's workflow execution state."""

from graphon.entities import WorkflowNodeExecution as GraphonWorkflowNodeExecution


class WorkflowNodeExecution(GraphonWorkflowNodeExecution):
    # Null for executions that were not invoked by a Workflow Tool.
    triggered_from_workflow_id: str | None = None
    triggered_from_node_execution_id: str | None = None
