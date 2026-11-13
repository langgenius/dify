from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import Field

from graphon.entities.pause_reason import PauseReason
from graphon.file.models import File
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events.base import NodeRunResult
from graphon.variables.segments import Segment
from graphon.variables.variables import Variable

from .base import NodeEventPayload


class RunRetrieverResourceEvent(NodeEventPayload):
    retriever_resources: Sequence[Mapping[str, Any]] = Field(
        ...,
        description="retriever resources",
    )
    context: str = Field(..., description="context")
    context_files: list[File] | None = Field(default=None, description="context files")


class ModelInvokeCompletedEvent(NodeEventPayload):
    text: str
    usage: LLMUsage
    finish_reason: str | None = None
    reasoning_content: str | None = None
    structured_output: dict | None = None


class ModelPollingProgressEvent(NodeEventPayload):
    attempt: int = Field(..., ge=0, description="polling check attempt count")
    last_checked_at: datetime = Field(..., description="last polling check time")
    next_check_at: datetime | None = Field(
        default=None,
        description="next polling check time; None means no further check is scheduled",
    )


class RunRetryEvent(NodeEventPayload):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="Retry attempt number")
    start_at: datetime = Field(..., description="Retry start time")


class StreamChunkEvent(NodeEventPayload):
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


class StreamReasoningEvent(NodeEventPayload):
    """Reasoning side-channel chunk scoped by selector visibility.

    This node-level selector is normalized by graph dispatch to
    ``[node_id, "reasoning_content"]`` before response filtering. It is not a
    normal answer stream and must not be buffered into answer text. Chunks are
    raw live deltas, so appending them is not guaranteed to equal the normalized
    final ``reasoning_content`` value. A run that streamed reasoning may finish
    with an empty ``is_final=True`` marker.
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


class StreamCompletedEvent(NodeEventPayload):
    node_run_result: NodeRunResult = Field(..., description="run result")


class VariableUpdatedEvent(NodeEventPayload):
    """Notify the engine that a single variable should be applied to the shared pool."""

    variable: Variable = Field(..., description="Updated variable payload to apply.")


class PauseRequestedEvent(NodeEventPayload):
    reason: PauseReason = Field(..., description="pause reason")


class HumanInputFormFilledEvent(NodeEventPayload):
    """Event emitted when a human input form is submitted."""

    node_title: str
    rendered_content: str
    action_id: str
    action_text: str

    # submitted_data records the data user submitted in the form inputs.
    # It is a mapping from FormInput.output_variable_name to
    # their runtime values.
    submitted_data: Mapping[str, Segment] = Field(default_factory=dict)


class HumanInputFormTimeoutEvent(NodeEventPayload):
    """Event emitted when a human input form times out."""

    node_title: str
    expiration_time: datetime
