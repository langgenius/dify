from collections.abc import Mapping
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from .base import GraphNodeEventBase


class NodeRunIterationStartedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class NodeRunIterationNextEvent(GraphNodeEventBase):
    node_title: str
    index: int = Field(..., description="index")
    pre_iteration_output: Optional[Any] = None


class NodeRunIterationSucceededEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0


class NodeRunIterationFailedEvent(GraphNodeEventBase):
    node_title: str
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")
