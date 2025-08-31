from typing import Any, Optional

from pydantic import Field

from core.workflow.graph_events import BaseGraphEvent


class GraphRunStartedEvent(BaseGraphEvent):
    pass


class GraphRunSucceededEvent(BaseGraphEvent):
    outputs: Optional[dict[str, Any]] = None


class GraphRunFailedEvent(BaseGraphEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: int = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(BaseGraphEvent):
    exceptions_count: int = Field(..., description="exception count")
    outputs: Optional[dict[str, Any]] = None


class GraphRunAbortedEvent(BaseGraphEvent):
    """Event emitted when a graph run is aborted by user command."""

    reason: Optional[str] = Field(default=None, description="reason for abort")
    outputs: Optional[dict[str, Any]] = Field(default=None, description="partial outputs if any")
