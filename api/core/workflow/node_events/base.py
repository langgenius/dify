from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class NodeEventBase(BaseModel):
    """Base class for all node events"""

    pass


def _default_metadata():
    v: Mapping[WorkflowNodeExecutionMetadataKey, Any] = {}
    return v


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.PENDING

    inputs: Mapping[str, Any] = Field(default_factory=dict)
    process_data: Mapping[str, Any] = Field(default_factory=dict)
    outputs: Mapping[str, Any] = Field(default_factory=dict)
    metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] = Field(default_factory=_default_metadata)
    llm_usage: LLMUsage = Field(default_factory=LLMUsage.empty_usage)

    edge_source_handle: str = "source"  # source handle id of node with multiple branches

    error: str = ""
    error_type: str = ""

    # single step node run retry
    retry_index: int = 0
