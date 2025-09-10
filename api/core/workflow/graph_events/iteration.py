from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pydantic import Field

from .base import GraphNodeEventBase


class NodeRunIterationStartedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    predecessor_node_id: str | None = None


class NodeRunIterationNextEvent(GraphNodeEventBase):
    node_title: str
    index: int = Field(..., description="index")
    pre_iteration_output: Any = None


class NodeRunIterationSucceededEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0


class NodeRunIterationFailedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
