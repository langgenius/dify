from pydantic import BaseModel, Field

from core.workflow.enums import NodeType
from core.workflow.node_events import NodeRunResult


class GraphEngineEvent(BaseModel):
    pass


class BaseGraphEvent(GraphEngineEvent):
    pass


class GraphNodeEventBase(GraphEngineEvent):
    id: str = Field(..., description="node execution id")
    node_id: str
    node_type: NodeType

    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""

    # The version of the node, or "1" if not specified.
    node_version: str = "1"
    node_run_result: NodeRunResult = Field(default_factory=NodeRunResult)


class GraphAgentNodeEventBase(GraphNodeEventBase):
    pass
