from pydantic import Field

from core.workflow.entities.pause_reason import PauseReason
from core.workflow.graph_events import BaseGraphEvent


class GraphRunStartedEvent(BaseGraphEvent):
    pass


class GraphRunSucceededEvent(BaseGraphEvent):
    """Event emitted when a run completes successfully with final outputs."""

    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Final workflow outputs keyed by output selector.",
    )


class GraphRunFailedEvent(BaseGraphEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: int = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(BaseGraphEvent):
    """Event emitted when a run finishes with partial success and failures."""

    exceptions_count: int = Field(..., description="exception count")
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs that were materialised before failures occurred.",
    )


class GraphRunAbortedEvent(BaseGraphEvent):
    """Event emitted when a graph run is aborted by user command."""

    reason: str | None = Field(default=None, description="reason for abort")
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs produced before the abort was requested.",
    )


class GraphRunPausedEvent(BaseGraphEvent):
    """Event emitted when a graph run is paused by user command."""

    # reason: str | None = Field(default=None, description="reason for pause")
    reason: PauseReason = Field(..., description="reason for pause")
    outputs: dict[str, object] = Field(
        default_factory=dict,
        description="Outputs available to the client while the run is paused.",
    )
