"""Data-only HTTP protocol for native Pydantic AI module runs.

Composition names resolve through a server-owned registry. Each module receives
current JSON Config and restored JSON State through deps.layers[name]; Config
and live services are never persisted. Snapshot v2 is keyed by name and has no
ordering or generic lifecycle state. Terminal events include a state snapshot
after native capability cleanup on success, failure and cancellation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, ClassVar, Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, model_validator
from pydantic_ai.messages import AgentStreamEvent

from dify_agent.protocol.snapshot import SessionSnapshot


DIFY_AGENT_MODEL_LAYER_ID: Final[str] = "llm"
DIFY_AGENT_HISTORY_LAYER_ID: Final[str] = "history"
DIFY_AGENT_OUTPUT_LAYER_ID: Final[str] = "output"
RunStatus = Literal["running", "succeeded", "failed", "cancelled"]
RunEventType = Literal[
    "run_started",
    "pydantic_ai_event",
    "run_succeeded",
    "run_failed",
    "run_cancelled",
]


class RunFailureType(StrEnum):
    """Stable machine-readable categories for failed Dify Agent runs.

    Run-limit failures cover Dify Agent's model-request budget and run wall-clock
    deadline. Provider and connection timeouts retain their own error categories.
    """

    AGENT_RUN_LIMIT_EXCEEDED = "agent_run_limit_exceeded"


def utc_now() -> datetime:
    """Return the timezone-aware timestamp format used by public schemas."""
    return datetime.now(timezone.utc)


class RunLayerSpec(BaseModel):
    """One registered module and its current JSON configuration."""

    name: str = Field(min_length=1)
    config: dict[str, JsonValue] = Field(default_factory=dict)
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunComposition(BaseModel):
    """Module configuration; instruction order is not a public contract."""

    schema_version: Literal[2] = 2
    layers: list[RunLayerSpec]
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateRunRequest(BaseModel):
    """Create a run using current Config and an optional state-only snapshot.

    The model slot is named llm, history and output are optional reserved slots.
    Product
    binding/workspace lifecycle and state storage are owned by the API caller.
    Native capabilities always release operation resources at run exit.
    """

    composition: RunComposition
    idempotency_key: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    session_snapshot: SessionSnapshot | None = None
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CancelRunRequest(BaseModel):
    """Request body for cancelling a run.

    Runtime cancellation is intentionally a separate protocol operation from
    failed execution so API callers can distinguish user/operator cancellation
    from model, tool, or infrastructure failures.
    """

    reason: str | None = None
    message: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateRunResponse(BaseModel):
    """Response returned after a run has been persisted and scheduled locally."""

    run_id: str
    status: RunStatus

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CancelRunResponse(BaseModel):
    """Response returned after a cancel request is accepted."""

    run_id: str
    status: Literal["cancelled"]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunStatusResponse(BaseModel):
    """Current server-side status for one run."""

    run_id: str
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    error: str | None = None
    error_type: RunFailureType | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EmptyRunEventData(BaseModel):
    """Typed empty payload for lifecycle events that carry no extra data."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentRunUsage(BaseModel):
    """Complete model usage reported for one Agent run.

    Pricing fields default to zero so events from older Agent backend versions that contain only
    token counts remain valid when a new consumer replays persisted Redis streams.
    """

    prompt_tokens: int = 0
    prompt_unit_price: Decimal = Decimal(0)
    prompt_price_unit: Decimal = Decimal(0)
    prompt_price: Decimal = Decimal(0)
    completion_tokens: int = 0
    completion_unit_price: Decimal = Decimal(0)
    completion_price_unit: Decimal = Decimal(0)
    completion_price: Decimal = Decimal(0)
    total_tokens: int = 0
    total_price: Decimal = Decimal(0)
    currency: str = "USD"
    latency: float = 0.0
    time_to_first_token: float | None = None
    time_to_generate: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _derive_total_tokens(self) -> AgentRunUsage:
        if self.total_tokens == 0 and (self.prompt_tokens > 0 or self.completion_tokens > 0):
            self.total_tokens = self.prompt_tokens + self.completion_tokens
        return self


class RunSucceededEventData(BaseModel):
    """Terminal final output and state captured after capability cleanup."""

    output: JsonValue
    session_snapshot: SessionSnapshot
    usage: AgentRunUsage | None = None
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunFailedEventData(BaseModel):
    """Terminal failure payload shown to polling and SSE consumers."""

    error: str
    error_type: RunFailureType | None = None
    reason: str | None = None
    session_snapshot: SessionSnapshot | None = None
    usage: AgentRunUsage | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunCancelledEventData(BaseModel):
    """Terminal cancellation payload for explicit user/operator cancellation."""

    reason: str | None = None
    message: str | None = None
    session_snapshot: SessionSnapshot | None = None
    usage: AgentRunUsage | None = None

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
    """Pydantic AI stream event with optional Dify Agent semantic annotations."""

    type: Literal["pydantic_ai_event"] = "pydantic_ai_event"
    data: AgentStreamEvent
    agent_message_delta: str | None = None


class RunSucceededEvent(BaseRunEvent):
    """Terminal success event carrying the complete successful run result."""

    type: Literal["run_succeeded"] = "run_succeeded"
    data: RunSucceededEventData


class RunFailedEvent(BaseRunEvent):
    """Terminal failure event atomically committed with the failed run status."""

    type: Literal["run_failed"] = "run_failed"
    data: RunFailedEventData


class RunCancelledEvent(BaseRunEvent):
    """Terminal cancellation event emitted after an explicit cancel request."""

    type: Literal["run_cancelled"] = "run_cancelled"
    data: RunCancelledEventData = Field(default_factory=RunCancelledEventData)


RunEvent: TypeAlias = Annotated[
    RunStartedEvent | PydanticAIStreamRunEvent | RunSucceededEvent | RunFailedEvent | RunCancelledEvent,
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
    "AgentRunUsage",
    "CancelRunRequest",
    "CancelRunResponse",
    "CreateRunRequest",
    "CreateRunResponse",
    "DIFY_AGENT_HISTORY_LAYER_ID",
    "DIFY_AGENT_MODEL_LAYER_ID",
    "DIFY_AGENT_OUTPUT_LAYER_ID",
    "EmptyRunEventData",
    "PydanticAIStreamRunEvent",
    "RUN_EVENT_ADAPTER",
    "RunCancelledEvent",
    "RunCancelledEventData",
    "RunComposition",
    "RunEvent",
    "RunEventType",
    "RunEventsResponse",
    "RunFailedEvent",
    "RunFailedEventData",
    "RunFailureType",
    "RunStartedEvent",
    "RunStatus",
    "RunStatusResponse",
    "RunSucceededEvent",
    "RunSucceededEventData",
    "RunLayerSpec",
    "SessionSnapshot",
    "utc_now",
]
