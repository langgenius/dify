from collections.abc import Mapping
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from .base import NodeEventBase


class IterationStartedEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class IterationNextEvent(NodeEventBase):
    index: int = Field(..., description="index")
    pre_iteration_output: Optional[Any] = None
    duration: Optional[float] = None


class IterationSucceededEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    iteration_duration_map: Optional[dict[str, float]] = None


class IterationFailedEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
