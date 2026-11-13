from collections.abc import Mapping, Sequence
from datetime import datetime

from pydantic import Field

from graphon.entities.pause_reason import PauseReason
from graphon.variables.segments import Segment
from graphon.variables.variables import Variable

from .base import NodeEvent


class NodeRunStartedEvent(NodeEvent):
    node_title: str
    predecessor_node_id: str | None = None
    start_at: datetime = Field(..., description="node start time")
    extras: dict[str, object] = Field(default_factory=dict)

    provider_type: str = ""
    provider_id: str = ""


class NodeRunStreamChunkEvent(NodeEvent):
    # Spec-compliant fields
    selector: Sequence[str] = Field(
        ...,
        description=(
            "selector identifying the output location (e.g., ['nodeA', 'text'])"
        ),
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(
        default=False,
        description="indicates if this is the last chunk",
    )


class NodeRunReasoningChunkEvent(NodeEvent):
    """Graph-level lift of :class:`StreamReasoningEvent`.

    The selector identifies the source and lets response filters enforce
    visibility. It is not a normal answer stream and must not be buffered into
    answer text. Chunks are raw live deltas, so appending them is not guaranteed
    to equal the normalized final ``reasoning_content`` value. A run that
    streamed reasoning may finish with an empty ``is_final=True`` marker.
    """

    selector: Sequence[str] = Field(
        ...,
        description=(
            "selector identifying the reasoning source "
            "(e.g., ['nodeA', 'reasoning_content'])"
        ),
    )
    chunk: str = Field(..., description="the reasoning chunk content")
    is_final: bool = Field(
        default=False,
        description="indicates if this is the last reasoning chunk for the node run",
    )


class NodeRunModelPollingProgressEvent(NodeEvent):
    attempt: int = Field(..., ge=0, description="polling check attempt count")
    last_checked_at: datetime = Field(..., description="last polling check time")
    next_check_at: datetime | None = Field(
        default=None,
        description="next polling check time; None means no further check is scheduled",
    )


class NodeRunRetrieverResourceEvent(NodeEvent):
    retriever_resources: Sequence[Mapping[str, object]] = Field(
        ...,
        description="retriever resources",
    )
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(NodeEvent):
    start_at: datetime = Field(..., description="node start time")
    finished_at: datetime | None = Field(default=None, description="node finish time")


class NodeRunVariableUpdatedEvent(NodeEvent):
    """Request that the engine apply a variable update before downstream
    observers continue.
    """

    variable: Variable = Field(..., description="Updated variable payload to apply.")


class NodeRunFailedEvent(NodeEvent):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")
    finished_at: datetime | None = Field(default=None, description="node finish time")


class NodeRunExceptionEvent(NodeEvent):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")
    finished_at: datetime | None = Field(default=None, description="node finish time")


class NodeRunRetryEvent(NodeRunStartedEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(
        ...,
        description="which retry attempt is about to be performed",
    )


class NodeRunHumanInputFormFilledEvent(NodeEvent):
    """Emitted when a HumanInput form is submitted and before the node finishes."""

    node_title: str = Field(..., description="HumanInput node title")
    rendered_content: str = Field(
        ...,
        description="Markdown content rendered with user inputs.",
    )
    action_id: str = Field(
        ...,
        description="User action identifier chosen in the form.",
    )
    action_text: str = Field(
        ...,
        description="Display text of the chosen action button.",
    )
    submitted_data: Mapping[str, Segment] = Field(
        default_factory=dict,
        description="Runtime submitted values keyed by form output variable name.",
    )


class NodeRunHumanInputFormTimeoutEvent(NodeEvent):
    """Emitted when a HumanInput form times out."""

    node_title: str = Field(..., description="HumanInput node title")
    expiration_time: datetime = Field(..., description="Form expiration time")


class NodeRunPauseRequestedEvent(NodeEvent):
    reason: PauseReason = Field(..., description="pause reason")


def is_node_result_event(event: NodeEvent) -> bool:
    """Check if an event is a final result event from node execution.

    A result event indicates the completion of a node execution and contains
    runtime information such as inputs, outputs, or error details.

    Args:
        event: The event to check

    Returns:
        True if the event is a node result event
        (succeeded/failed/paused), False otherwise

    """
    return isinstance(
        event,
        (
            NodeRunSucceededEvent,
            NodeRunFailedEvent,
            NodeRunPauseRequestedEvent,
        ),
    )
