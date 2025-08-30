from collections.abc import Mapping
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from .base import GraphNodeEventBase


class NodeRunLoopStartedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class NodeRunLoopNextEvent(GraphNodeEventBase):
    node_title: str
    index: int = Field(..., description="index")
    pre_loop_output: Optional[Any] = None


class NodeRunLoopSucceededEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0


class NodeRunLoopFailedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
