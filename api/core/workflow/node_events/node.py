from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum

from pydantic import Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities.pause_reason import PauseReason
from core.workflow.node_events import NodeRunResult

from .base import NodeEventBase


class RunRetrieverResourceEvent(NodeEventBase):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class ModelInvokeCompletedEvent(NodeEventBase):
    text: str
    usage: LLMUsage
    finish_reason: str | None = None
    reasoning_content: str | None = None
    structured_output: dict | None = None


class RunRetryEvent(NodeEventBase):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="Retry attempt number")
    start_at: datetime = Field(..., description="Retry start time")


class ChunkType(StrEnum):
    """Stream chunk type for LLM-related events."""

    TEXT = "text"  # Normal text streaming
    TOOL_CALL = "tool_call"  # Tool call arguments streaming
    TOOL_RESULT = "tool_result"  # Tool execution result
    THOUGHT = "thought"  # Agent thinking process (ReAct)


class StreamChunkEvent(NodeEventBase):
    """Base stream chunk event - normal text streaming output."""

    selector: Sequence[str] = Field(
        ..., description="selector identifying the output location (e.g., ['nodeA', 'text'])"
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(default=False, description="indicates if this is the last chunk")
    chunk_type: ChunkType = Field(default=ChunkType.TEXT, description="type of the chunk")


class ToolCallChunkEvent(StreamChunkEvent):
    """Tool call streaming event - tool call arguments streaming output."""

    chunk_type: ChunkType = Field(default=ChunkType.TOOL_CALL, frozen=True)
    tool_call_id: str = Field(..., description="unique identifier for this tool call")
    tool_name: str = Field(..., description="name of the tool being called")
    tool_arguments: str = Field(default="", description="accumulated tool arguments JSON")


class ToolResultChunkEvent(StreamChunkEvent):
    """Tool result event - tool execution result."""

    chunk_type: ChunkType = Field(default=ChunkType.TOOL_RESULT, frozen=True)
    tool_call_id: str = Field(..., description="identifier of the tool call this result belongs to")
    tool_name: str = Field(..., description="name of the tool")
    tool_files: list[str] = Field(default_factory=list, description="file IDs produced by tool")
    tool_error: str | None = Field(default=None, description="error message if tool failed")


class ThoughtChunkEvent(StreamChunkEvent):
    """Agent thought streaming event - Agent thinking process (ReAct)."""

    chunk_type: ChunkType = Field(default=ChunkType.THOUGHT, frozen=True)
    round_index: int = Field(default=1, description="current iteration round")


class StreamCompletedEvent(NodeEventBase):
    node_run_result: NodeRunResult = Field(..., description="run result")


class PauseRequestedEvent(NodeEventBase):
    reason: PauseReason = Field(..., description="pause reason")
