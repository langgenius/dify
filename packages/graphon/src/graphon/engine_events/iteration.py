from collections.abc import Mapping
from datetime import datetime

from pydantic import Field

from .base import NodeEvent


class NodeRunIterationStartedEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    predecessor_node_id: str | None = None


class NodeRunIterationNextEvent(NodeEvent):
    node_title: str
    index: int = Field(..., description="index")
    pre_iteration_output: object = None


class NodeRunIterationSucceededEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0


class NodeRunIterationFailedEvent(NodeEvent):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0
    error: str = Field(..., description="failed reason")
