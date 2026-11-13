"""Shared agent-log event contract for Agent v1 and v2 nodes.

``AgentLogEvent`` is the payload projected by agent node executions and
``NodeRunAgentLogEvent`` is its node-run envelope; ``workflow_app_runner``
maps the latter to ``QueueAgentLogEvent`` for SSE delivery.
"""

from collections.abc import Mapping
from typing import Any

from pydantic import Field

from graphon.engine_events import NodeEvent
from graphon.enums import NodeType
from graphon.node_events import NodeEventPayload


class AgentLogEvent(NodeEventPayload):
    message_id: str = Field(..., description="id")
    label: str = Field(..., description="label")
    node_execution_id: str = Field(..., description="node execution id")
    parent_id: str | None = Field(..., description="parent id")
    error: str | None = Field(..., description="error")
    status: str = Field(..., description="status")
    data: Mapping[str, Any] = Field(..., description="data")
    metadata: Mapping[str, Any] = Field(default_factory=dict, description="metadata")
    node_id: str = Field(..., description="node id")


class NodeRunAgentLogEvent(NodeEvent):
    message_id: str = Field(..., description="message id")
    label: str = Field(..., description="label")
    node_execution_id: str = Field(..., description="node execution id")
    parent_id: str | None = Field(..., description="parent id")
    error: str | None = Field(..., description="error")
    status: str = Field(..., description="status")
    data: Mapping[str, object] = Field(..., description="data")
    metadata: Mapping[str, object] = Field(default_factory=dict)


def node_run_agent_log_event(
    event: AgentLogEvent,
    *,
    execution_id: str,
    node_id: str,
    node_type: NodeType,
) -> NodeRunAgentLogEvent:
    """Build the node-run ``agent_log`` event for one projected payload.

    Precondition: ``event`` was emitted by the node's own execution. The
    returned event is stamped with the node's execution id, node id, and
    node type; every payload field passes through unchanged.
    """
    return NodeRunAgentLogEvent(
        id=execution_id,
        node_id=node_id,
        node_type=node_type,
        message_id=event.message_id,
        label=event.label,
        node_execution_id=event.node_execution_id,
        parent_id=event.parent_id,
        error=event.error,
        status=event.status,
        data=event.data,
        metadata=event.metadata,
    )
