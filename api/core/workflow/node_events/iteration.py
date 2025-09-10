from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pydantic import Field

from .base import NodeEventBase


class IterationStartedEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    predecessor_node_id: str | None = None


class IterationNextEvent(NodeEventBase):
    index: int = Field(..., description="index")
    pre_iteration_output: Any = None


class IterationSucceededEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0


class IterationFailedEvent(NodeEventBase):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
