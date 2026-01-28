from collections.abc import Sequence
from datetime import datetime

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


class NodeRunStreamChunkEvent(GraphNodeEventBase):
    # Spec-compliant fields
    selector: Sequence[str] = Field(
        ..., description="selector identifying the output location (e.g., ['nodeA', 'text'])"
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(default=False, description="indicates if this is the last chunk")


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
