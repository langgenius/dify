"""Public API schemas for the Dify Agent run server.

The server accepts only registry-backed Agenton compositor configs. This keeps
HTTP input data-only and prevents unsafe import-path construction. Run events are
append-only records; Redis stream ids (or in-memory equivalents in tests) are the
public cursors used by polling and SSE replay. Event envelopes keep the public
``id``/``run_id``/``type``/``data``/``created_at`` shape, but each ``type`` has a
typed ``data`` model so OpenAPI, Redis replay, and runtime producers agree on the
payload contract.
"""

from datetime import datetime, timezone
from typing import Annotated, Literal, TypeAlias
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorConfig, CompositorSessionSnapshot


RunStatus = Literal["running", "succeeded", "failed"]
RunEventType = Literal[
    "run_started",
    "pydantic_ai_event",
    "agent_output",
    "session_snapshot",
    "run_succeeded",
    "run_failed",
]


def new_run_id() -> str:
    """Return a stable external run id."""
    return str(uuid4())


def utc_now() -> datetime:
    """Return the timestamp format used by public schemas."""
    return datetime.now(timezone.utc)


class AgentProfileConfig(BaseModel):
    """Minimal model profile for the MVP runner.

    ``test`` uses pydantic-ai's ``TestModel`` and is credential-free. Other
    profiles can be added behind this schema without changing run/event storage.
    """

    provider: Literal["test"] = "test"
    output_text: str = "Hello from the Dify Agent test model."

    model_config = ConfigDict(extra="forbid")


class CreateRunRequest(BaseModel):
    """Request body for creating one async agent run."""

    compositor: CompositorConfig
    session_snapshot: CompositorSessionSnapshot | None = None
    agent_profile: AgentProfileConfig = Field(default_factory=AgentProfileConfig)

    model_config = ConfigDict(extra="forbid")


class CreateRunResponse(BaseModel):
    """Response returned after a run has been persisted and scheduled locally."""

    run_id: str
    status: RunStatus

    model_config = ConfigDict(extra="forbid")


class RunStatusResponse(BaseModel):
    """Current server-side status for one run."""

    run_id: str
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    error: str | None = None

    model_config = ConfigDict(extra="forbid")


class EmptyRunEventData(BaseModel):
    """Typed empty payload for lifecycle events that carry no extra data."""

    model_config = ConfigDict(extra="forbid")


class AgentOutputRunEventData(BaseModel):
    """Final agent output payload emitted before the session snapshot."""

    output: str

    model_config = ConfigDict(extra="forbid")


class RunFailedEventData(BaseModel):
    """Terminal failure payload shown to polling and SSE consumers."""

    error: str
    reason: str | None = None

    model_config = ConfigDict(extra="forbid")


class BaseRunEvent(BaseModel):
    """Shared append-only event envelope visible through polling and SSE."""

    id: str | None = None
    run_id: str
    created_at: datetime = Field(default_factory=utc_now)

    model_config = ConfigDict(extra="forbid")


class RunStartedEvent(BaseRunEvent):
    """Run lifecycle event emitted before runtime execution starts."""

    type: Literal["run_started"] = "run_started"
    data: EmptyRunEventData = Field(default_factory=EmptyRunEventData)


class PydanticAIStreamRunEvent(BaseRunEvent):
    """Pydantic AI stream event using the upstream typed event model."""

    type: Literal["pydantic_ai_event"] = "pydantic_ai_event"
    data: AgentStreamEvent


class AgentOutputRunEvent(BaseRunEvent):
    """Run event carrying the final agent output string."""

    type: Literal["agent_output"] = "agent_output"
    data: AgentOutputRunEventData


class SessionSnapshotRunEvent(BaseRunEvent):
    """Run event carrying the resumable Agenton session snapshot."""

    type: Literal["session_snapshot"] = "session_snapshot"
    data: CompositorSessionSnapshot


class RunSucceededEvent(BaseRunEvent):
    """Terminal success event emitted after output and session snapshot."""

    type: Literal["run_succeeded"] = "run_succeeded"
    data: EmptyRunEventData = Field(default_factory=EmptyRunEventData)


class RunFailedEvent(BaseRunEvent):
    """Terminal failure event emitted before the run status becomes failed."""

    type: Literal["run_failed"] = "run_failed"
    data: RunFailedEventData



RunEvent: TypeAlias = Annotated[
    RunStartedEvent
    | PydanticAIStreamRunEvent
    | AgentOutputRunEvent
    | SessionSnapshotRunEvent
    | RunSucceededEvent
    | RunFailedEvent,
    Field(discriminator="type"),
]
RUN_EVENT_ADAPTER = TypeAdapter(RunEvent)


class RunEventsResponse(BaseModel):
    """Cursor-paginated event log response."""

    run_id: str
    events: list[RunEvent]
    next_cursor: str | None = None

    model_config = ConfigDict(extra="forbid")


class RunRecord(BaseModel):
    """Internal representation persisted for status reads."""

    run_id: str
    status: RunStatus
    request: CreateRunRequest
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    error: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("updated_at")
    @classmethod
    def updated_at_must_be_timezone_aware(cls, value: datetime) -> datetime:
        """Reject naive timestamps before they become JSON API values."""
        if value.tzinfo is None:
            raise ValueError("updated_at must be timezone-aware")
        return value


__all__ = [
    "AgentProfileConfig",
    "AgentOutputRunEvent",
    "AgentOutputRunEventData",
    "BaseRunEvent",
    "CreateRunRequest",
    "CreateRunResponse",
    "EmptyRunEventData",
    "PydanticAIStreamRunEvent",
    "RUN_EVENT_ADAPTER",
    "RunEvent",
    "RunEventsResponse",
    "RunFailedEvent",
    "RunFailedEventData",
    "RunRecord",
    "RunStartedEvent",
    "RunStatus",
    "RunStatusResponse",
    "RunSucceededEvent",
    "SessionSnapshotRunEvent",
    "new_run_id",
    "utc_now",
]
