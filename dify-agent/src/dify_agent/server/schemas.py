"""Public API schemas for the Dify Agent run server.

The server accepts only registry-backed Agenton compositor configs. This keeps
HTTP input data-only and prevents unsafe import-path construction. Run events are
append-only records; Redis stream ids (or in-memory equivalents in tests) are the
public cursors used by polling and SSE replay.
"""

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from agenton.compositor import CompositorConfig, CompositorSessionSnapshot


RunStatus = Literal["queued", "running", "succeeded", "failed"]
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
    """Response returned after a run job has been durably queued."""

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


class RunEvent(BaseModel):
    """Append-only event visible through polling and SSE."""

    id: str | None = None
    run_id: str
    type: RunEventType
    data: JsonValue = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

    model_config = ConfigDict(extra="forbid")


class RunEventsResponse(BaseModel):
    """Cursor-paginated event log response."""

    run_id: str
    events: list[RunEvent]
    next_cursor: str | None = None

    model_config = ConfigDict(extra="forbid")


class RunnerJob(BaseModel):
    """Durable worker payload stored in Redis streams."""

    run_id: str
    request: CreateRunRequest

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
    "CreateRunRequest",
    "CreateRunResponse",
    "RunEvent",
    "RunEventsResponse",
    "RunRecord",
    "RunStatus",
    "RunStatusResponse",
    "RunnerJob",
    "new_run_id",
    "utc_now",
]
