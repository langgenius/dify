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
    MODEL_START = "model_start"  # Model turn started with identity info
    MODEL_END = "model_end"  # Model turn completed with metrics


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

    # Model identity fields (when chunk_type == MODEL_START)
    model_provider: str | None = Field(default=None, description="model provider identifier")
    model_name: str | None = Field(default=None, description="model name")
    model_icon: str | dict | None = Field(default=None, description="model provider icon")
    model_icon_dark: str | dict | None = Field(default=None, description="model provider dark icon")
    # Model metrics fields (when chunk_type == MODEL_END)
    model_usage: dict | None = Field(default=None, description="per-turn token usage as dict")
    model_duration: float | None = Field(default=None, description="per-turn duration in seconds")


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


class NodeRunHumanInputFormFilledEvent(GraphNodeEventBase):
    """Emitted when a HumanInput form is submitted and before the node finishes."""

    node_title: str = Field(..., description="HumanInput node title")
    rendered_content: str = Field(..., description="Markdown content rendered with user inputs.")
    action_id: str = Field(..., description="User action identifier chosen in the form.")
    action_text: str = Field(..., description="Display text of the chosen action button.")


class NodeRunHumanInputFormTimeoutEvent(GraphNodeEventBase):
    """Emitted when a HumanInput form times out."""

    node_title: str = Field(..., description="HumanInput node title")
    expiration_time: datetime = Field(..., description="Form expiration time")


class NodeRunPauseRequestedEvent(GraphNodeEventBase):
    reason: PauseReason = Field(..., description="pause reason")


def is_node_result_event(event: GraphNodeEventBase) -> bool:
    """
    Check if an event is a final result event from node execution.

    A result event indicates the completion of a node execution and contains
    runtime information such as inputs, outputs, or error details.

    Args:
        event: The event to check

    Returns:
        True if the event is a node result event (succeeded/failed/paused), False otherwise
    """
    return isinstance(
        event,
        (
            NodeRunSucceededEvent,
            NodeRunFailedEvent,
            NodeRunPauseRequestedEvent,
        ),
    )
