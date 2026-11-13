from collections.abc import Mapping
from datetime import datetime

from pydantic import Field

from .base import NodeEvent


class NodeRunLoopStartedEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    predecessor_node_id: str | None = None


class NodeRunLoopNextEvent(NodeEvent):
    node_title: str
    index: int = Field(..., description="index")
    pre_loop_output: object = None


class NodeRunLoopSucceededEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0


class NodeRunLoopFailedEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0
    error: str = Field(..., description="failed reason")
