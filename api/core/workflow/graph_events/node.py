from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum

from pydantic import Field

from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities import AgentNodeStrategyInit
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
    tool_call_id: str | None = Field(default=None, description="unique identifier for this tool call")
    tool_name: str | None = Field(default=None, description="name of the tool being called")
    tool_arguments: str | None = Field(default=None, description="accumulated tool arguments JSON")

    # Tool result fields (when chunk_type == TOOL_RESULT)
    tool_files: list[str] = Field(default_factory=list, description="file IDs produced by tool")
    tool_error: str | None = Field(default=None, description="error message if tool failed")

    # Thought fields (when chunk_type == THOUGHT)
    round_index: int | None = Field(default=None, description="current iteration round")


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
