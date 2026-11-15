from pydantic import BaseModel, Field

from graphon.enums import NodeType
from graphon.node_events.base import NodeRunResult


class EngineEvent(BaseModel):
    """Base model for events emitted by the engine."""

    container_id: str = ""
    """ID of the container that directly owns the event's execution frame."""


class NodeEvent(EngineEvent):
    """Engine event associated with one node execution."""

    id: str = Field(..., description="node execution id")
    node_id: str
    node_type: NodeType

    # The version of the node, or "1" if not specified.
    node_version: str = "1"
    node_run_result: NodeRunResult = Field(default_factory=NodeRunResult)
