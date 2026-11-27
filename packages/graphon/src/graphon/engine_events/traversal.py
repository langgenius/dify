from pydantic import Field

from graphon.engine_events.base import EngineEvent


class _GraphEdgeTraversalEvent(EngineEvent):
    frame_id: str = Field(..., description="execution frame containing the edge")
    edge_id: str = Field(..., description="edge id")
    source_node_id: str = Field(..., description="source node id")
    target_node_id: str = Field(..., description="target node id")
    source_handle: str | None = Field(default=None, description="source handle")


class GraphEdgeTakenEvent(_GraphEdgeTraversalEvent):
    """Event emitted when graph traversal marks an edge as taken."""


class GraphEdgeSkippedEvent(_GraphEdgeTraversalEvent):
    """Event emitted when graph traversal marks an edge as skipped."""
