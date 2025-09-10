from typing import Any

from pydantic import Field

from core.workflow.graph_events import BaseGraphEvent


class GraphRunStartedEvent(BaseGraphEvent):
    pass


class GraphRunSucceededEvent(BaseGraphEvent):
    outputs: dict[str, Any] | None = None


class GraphRunFailedEvent(BaseGraphEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: int = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(BaseGraphEvent):
    exceptions_count: int = Field(..., description="exception count")
    outputs: dict[str, Any] | None = None


class GraphRunAbortedEvent(BaseGraphEvent):
    """Event emitted when a graph run is aborted by user command."""

    reason: str | None = Field(default=None, description="reason for abort")
    outputs: dict[str, Any] | None = Field(default=None, description="partial outputs if any")
