from collections.abc import Mapping
from typing import Any

from pydantic import Field

from graphon.graph_events import GraphNodeEventBase
from graphon.node_events import NodeEventBase


class AgentLogEvent(NodeEventBase):
    message_id: str = Field(..., description="id")
    label: str = Field(..., description="label")
    node_execution_id: str = Field(..., description="node execution id")
    parent_id: str | None = Field(..., description="parent id")
    error: str | None = Field(..., description="error")
    status: str = Field(..., description="status")
    data: Mapping[str, Any] = Field(..., description="data")
    metadata: Mapping[str, Any] = Field(default_factory=dict, description="metadata")
    node_id: str = Field(..., description="node id")


class GraphAgentNodeEventBase(GraphNodeEventBase):
    pass


class NodeRunAgentLogEvent(GraphAgentNodeEventBase):
    message_id: str = Field(..., description="message id")
    label: str = Field(..., description="label")
    node_execution_id: str = Field(..., description="node execution id")
    parent_id: str | None = Field(..., description="parent id")
    error: str | None = Field(..., description="error")
    status: str = Field(..., description="status")
    data: Mapping[str, object] = Field(..., description="data")
    metadata: Mapping[str, object] = Field(default_factory=dict)
