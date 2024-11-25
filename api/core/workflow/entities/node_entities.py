from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMUsage
from models.workflow import WorkflowNodeExecutionStatus


class NodeRunMetadataKey(StrEnum):
    """
    Node Run Metadata Key.
    """

    TOTAL_TOKENS = "total_tokens"
    TOTAL_PRICE = "total_price"
    CURRENCY = "currency"
    TOOL_INFO = "tool_info"
    ITERATION_ID = "iteration_id"
    ITERATION_INDEX = "iteration_index"
    PARALLEL_ID = "parallel_id"
    PARALLEL_START_NODE_ID = "parallel_start_node_id"
    PARENT_PARALLEL_ID = "parent_parallel_id"
    PARENT_PARALLEL_START_NODE_ID = "parent_parallel_start_node_id"
    PARALLEL_MODE_RUN_ID = "parallel_mode_run_id"
    ITERATION_DURATION_MAP = "iteration_duration_map"  # single iteration duration if iteration node runs


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[Mapping[str, Any]] = None  # node inputs
    process_data: Optional[dict[str, Any]] = None  # process data
    outputs: Optional[Mapping[str, Any]] = None  # node outputs
    metadata: Optional[dict[NodeRunMetadataKey, Any]] = None  # node metadata
    llm_usage: Optional[LLMUsage] = None  # llm usage

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None  # error message if status is failed
