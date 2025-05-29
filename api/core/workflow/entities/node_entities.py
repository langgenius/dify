from collections.abc import Mapping
from typing import Any, Optional

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[Mapping[str, Any]] = None  # node inputs
    process_data: Optional[Mapping[str, Any]] = None  # process data
    outputs: Optional[Mapping[str, Any]] = None  # node outputs
    metadata: Optional[Mapping[WorkflowNodeExecutionMetadataKey, Any]] = None  # node metadata
    llm_usage: Optional[LLMUsage] = None  # llm usage

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None  # error message if status is failed
    error_type: Optional[str] = None  # error type if status is failed

    # single step node run retry
    retry_index: int = 0


class AgentNodeStrategyInit(BaseModel):
    name: str
    icon: str | None = None
