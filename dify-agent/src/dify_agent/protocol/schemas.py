"""Public HTTP protocol schemas for the Dify Agent run API.

This module is the shared wire contract for the FastAPI server, runtime event
producers, storage adapters, and Python client. The server accepts only
registry-backed Agenton compositor configs, keeping HTTP input data-only and
preventing unsafe import-path construction. Run events are append-only records;
Redis stream ids (or in-memory equivalents in tests) are the public cursors used
by polling and SSE replay. Event envelopes keep the public
``id``/``run_id``/``type``/``data``/``created_at`` shape, while each ``type`` has
a typed ``data`` model so OpenAPI, Redis replay, and clients parse the same
payload contract. Model/provider selection is part of the submitted Agenton
layer graph, not a top-level run field; the runtime reads the model layer named
by ``DIFY_AGENT_MODEL_LAYER_ID``. Successful runs publish the final JSON-safe
agent output and the resumable Agenton session snapshot together on the terminal
``run_succeeded`` event so consumers can treat terminal events as complete run
summaries.
"""

from datetime import datetime, timezone
from typing import Annotated, ClassVar, Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorConfig, CompositorSessionSnapshot


DIFY_AGENT_MODEL_LAYER_ID: Final[str] = "llm"
RunStatus = Literal["running", "succeeded", "failed"]
RunEventType = Literal[
    "run_started",
    "pydantic_ai_event",
    "run_succeeded",
    "run_failed",
]


def utc_now() -> datetime:
    """Return the timezone-aware timestamp format used by public schemas."""
    return datetime.now(timezone.utc)


class CreateRunRequest(BaseModel):
    """Request body for creating one async agent run.

    Model/provider configuration must be supplied through the compositor layer
    named by ``DIFY_AGENT_MODEL_LAYER_ID``.
    """

    compositor: CompositorConfig
    session_snapshot: CompositorSessionSnapshot | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateRunResponse(BaseModel):
    """Response returned after a run has been persisted and scheduled locally."""

    run_id: str
    status: RunStatus

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunStatusResponse(BaseModel):
    """Current server-side status for one run."""

    run_id: str
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EmptyRunEventData(BaseModel):
    """Typed empty payload for lifecycle events that carry no extra data."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunSucceededEventData(BaseModel):
    """Terminal success payload for final output and resumable session state."""

    output: JsonValue
    session_snapshot: CompositorSessionSnapshot

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunFailedEventData(BaseModel):
    """Terminal failure payload shown to polling and SSE consumers."""

    error: str
    reason: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BaseRunEvent(BaseModel):
    """Shared append-only event envelope visible through polling and SSE."""

    id: str | None = None
    run_id: str
    created_at: datetime = Field(default_factory=utc_now)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunStartedEvent(BaseRunEvent):
    """Run lifecycle event emitted before runtime execution starts."""

    type: Literal["run_started"] = "run_started"
    data: EmptyRunEventData = Field(default_factory=EmptyRunEventData)


class PydanticAIStreamRunEvent(BaseRunEvent):
    """Pydantic AI stream event using the upstream typed event model."""

    type: Literal["pydantic_ai_event"] = "pydantic_ai_event"
    data: AgentStreamEvent


class RunSucceededEvent(BaseRunEvent):
    """Terminal success event carrying the complete successful run result."""

    type: Literal["run_succeeded"] = "run_succeeded"
    data: RunSucceededEventData


class RunFailedEvent(BaseRunEvent):
    """Terminal failure event emitted before the run status becomes failed."""

    type: Literal["run_failed"] = "run_failed"
    data: RunFailedEventData


RunEvent: TypeAlias = Annotated[
    RunStartedEvent
    | PydanticAIStreamRunEvent
    | RunSucceededEvent
    | RunFailedEvent,
    Field(discriminator="type"),
]
RUN_EVENT_ADAPTER: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)


class RunEventsResponse(BaseModel):
    """Cursor-paginated event log response."""

    run_id: str
    events: list[RunEvent]
    next_cursor: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BaseRunEvent",
    "CreateRunRequest",
    "CreateRunResponse",
    "DIFY_AGENT_MODEL_LAYER_ID",
    "EmptyRunEventData",
    "PydanticAIStreamRunEvent",
    "RUN_EVENT_ADAPTER",
    "RunEvent",
    "RunEventType",
    "RunEventsResponse",
    "RunFailedEvent",
    "RunFailedEventData",
    "RunStartedEvent",
    "RunStatus",
    "RunStatusResponse",
    "RunSucceededEvent",
    "RunSucceededEventData",
    "utc_now",
]
