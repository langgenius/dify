from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pydantic import Field

from .base import GraphNodeEventBase


class NodeRunLoopStartedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    predecessor_node_id: str | None = None


class NodeRunLoopNextEvent(GraphNodeEventBase):
    node_title: str
    index: int = Field(..., description="index")
    pre_loop_output: Any = None


class NodeRunLoopSucceededEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0


class NodeRunLoopFailedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0
    error: str = Field(..., description="failed reason")
