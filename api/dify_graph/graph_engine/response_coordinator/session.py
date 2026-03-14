"""
Internal response session management for response coordinator.

This module contains the private ResponseSession class used internally
by ResponseStreamCoordinator to manage streaming sessions.
"""

from __future__ import annotations

from dataclasses import dataclass

from dify_graph.nodes import NodeType
from dify_graph.nodes.base.template import Template
from dify_graph.runtime.graph_runtime_state import NodeProtocol


@dataclass
class ResponseSession:
    """
    Represents an active response streaming session.

    Note: This is an internal class not exposed in the public API.
    """

    node_id: str
    template: Template  # Template object from the response node
    index: int = 0  # Current position in the template segments

    @classmethod
    def from_node(cls, node: NodeProtocol) -> ResponseSession:
        """
        Create a ResponseSession from a response-capable node.

        The parameter is typed as `NodeProtocol` because the graph is exposed behind a protocol at the runtime layer.
        At runtime this must be a response node that exposes `id` and `get_streaming_template()`.

        Args:
            node: Node from the materialized workflow graph.

        Returns:
            ResponseSession configured with the node's streaming template

        Raises:
            TypeError: If node is not a supported response node type.
        """
        if getattr(node, "node_type", None) not in {NodeType.ANSWER, NodeType.END, NodeType.KNOWLEDGE_INDEX}:
            raise TypeError("ResponseSession.from_node only supports answer, end, or knowledge-index nodes")
        if not hasattr(node, "get_streaming_template"):
            raise TypeError("ResponseSession.from_node requires get_streaming_template() on response nodes")
        return cls(
            node_id=node.id,
            template=node.get_streaming_template(),
        )

    def is_complete(self) -> bool:
        """Check if all segments in the template have been processed."""
        return self.index >= len(self.template.segments)
