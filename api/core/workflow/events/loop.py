from collections.abc import Mapping
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from core.workflow.events.base import BaseLoopEvent


class LoopRunStartedEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class LoopRunNextEvent(BaseLoopEvent):
    index: int = Field(..., description="index")
    pre_loop_output: Optional[Any] = None
    duration: Optional[float] = None


class LoopRunSucceededEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    loop_duration_map: Optional[dict[str, float]] = None


class LoopRunFailedEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
