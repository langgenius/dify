from pydantic import Field

from graphon.engine_events.base import EngineEvent
from graphon.entities.pause_reason import PauseReason
from graphon.entities.workflow_start_reason import WorkflowStartReason


class GraphRunStartedEvent(EngineEvent):
    # Reason is emitted for workflow start events and is always set.
    reason: WorkflowStartReason = Field(
        default=WorkflowStartReason.INITIAL,
        description="reason for workflow start",
    )


class GraphRunSucceededEvent(EngineEvent):
    """Event emitted when a run completes successfully with final outputs."""

    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Final workflow outputs keyed by output selector.",
    )


class GraphRunFailedEvent(EngineEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: int = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(EngineEvent):
    """Event emitted when a run finishes with partial success and failures."""

    exceptions_count: int = Field(..., description="exception count")
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs that were materialised before failures occurred.",
    )


class GraphRunAbortedEvent(EngineEvent):
    """Event emitted when a graph run is aborted by user command."""

    reason: str | None = Field(default=None, description="reason for abort")
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs produced before the abort was requested.",
    )


class GraphRunPausedEvent(EngineEvent):
    """Event emitted when a graph run is paused by user command."""

    reasons: list[PauseReason] = Field(
        description="reason for pause",
        default_factory=list,
    )
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs available to the client while the run is paused.",
    )
