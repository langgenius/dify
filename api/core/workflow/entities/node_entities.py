from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Mapping[str, Any] | None = None  # node inputs
    process_data: Mapping[str, Any] | None = None  # process data
    outputs: Mapping[str, Any] | None = None  # node outputs
    metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None  # node metadata
    llm_usage: LLMUsage | None = None  # llm usage

    edge_source_handle: str | None = None  # source handle id of node with multiple branches

    error: str | None = None  # error message if status is failed
    error_type: str | None = None  # error type if status is failed

    # single step node run retry
    retry_index: int = 0


class AgentNodeStrategyInit(BaseModel):
    name: str
    icon: str | None = None
