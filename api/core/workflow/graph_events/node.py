from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum

from pydantic import Field

from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities import AgentNodeStrategyInit, ToolCall, ToolResult
from core.workflow.entities.pause_reason import PauseReason

from .base import GraphNodeEventBase


class NodeRunStartedEvent(GraphNodeEventBase):
    node_title: str
    predecessor_node_id: str | None = None
    agent_strategy: AgentNodeStrategyInit | None = None
    start_at: datetime = Field(..., description="node start time")

    # FIXME(-LAN-): only for ToolNode
    provider_type: str = ""
    provider_id: str = ""


class ChunkType(StrEnum):
    """Stream chunk type for LLM-related events."""

    TEXT = "text"  # Normal text streaming
    TOOL_CALL = "tool_call"  # Tool call arguments streaming
    TOOL_RESULT = "tool_result"  # Tool execution result
    THOUGHT = "thought"  # Agent thinking process (ReAct)
    THOUGHT_START = "thought_start"  # Agent thought start
    THOUGHT_END = "thought_end"  # Agent thought end


class NodeRunStreamChunkEvent(GraphNodeEventBase):
    """Stream chunk event for workflow node execution."""

    # Base fields
    selector: Sequence[str] = Field(
        ..., description="selector identifying the output location (e.g., ['nodeA', 'text'])"
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(default=False, description="indicates if this is the last chunk")
    chunk_type: ChunkType = Field(default=ChunkType.TEXT, description="type of the chunk")

    # Tool call fields (when chunk_type == TOOL_CALL)
    tool_call: ToolCall | None = Field(
        default=None,
        description="structured payload for tool_call chunks",
    )

    # Tool result fields (when chunk_type == TOOL_RESULT)
    tool_result: ToolResult | None = Field(
        default=None,
        description="structured payload for tool_result chunks",
    )


class NodeRunRetrieverResourceEvent(GraphNodeEventBase):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(GraphNodeEventBase):
    start_at: datetime = Field(..., description="node start time")


class NodeRunFailedEvent(GraphNodeEventBase):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")


class NodeRunExceptionEvent(GraphNodeEventBase):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")


class NodeRunRetryEvent(NodeRunStartedEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="which retry attempt is about to be performed")


class NodeRunPauseRequestedEvent(GraphNodeEventBase):
    reason: PauseReason = Field(..., description="pause reason")
