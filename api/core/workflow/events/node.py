from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities.node_entities import AgentNodeStrategyInit
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus

from .base import BaseNodeEvent, NodeEvent


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[WorkflowNodeExecutionMetadataKey, Any]] = None
    llm_usage: Optional[LLMUsage] = None

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None
    error_type: Optional[str] = None

    # single step node run retry
    retry_index: int = 0


class NodeRunStartedEvent(BaseNodeEvent):
    predecessor_node_id: Optional[str] = None
    parallel_mode_run_id: Optional[str] = None
    agent_strategy: Optional[AgentNodeStrategyInit] = None


class NodeRunStreamChunkEvent(BaseNodeEvent):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: Optional[list[str]] = None


class NodeRunRetrieverResourceEvent(BaseNodeEvent):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(BaseNodeEvent):
    pass


class NodeRunFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeRunExceptionEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeInIterationFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeInLoopFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeRunRetryEvent(NodeRunStartedEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="which retry attempt is about to be performed")
    start_at: datetime = Field(..., description="retry start time")


class RunCompletedEvent(NodeEvent):
    run_result: NodeRunResult = Field(..., description="run result")


class RunStreamChunkEvent(NodeEvent):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: list[str] = Field(..., description="from variable selector")


class RunRetrieverResourceEvent(NodeEvent):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class ModelInvokeCompletedEvent(NodeEvent):
    text: str
    usage: LLMUsage
    finish_reason: str | None = None


class RunRetryEvent(NodeEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="Retry attempt number")
    start_at: datetime = Field(..., description="Retry start time")
