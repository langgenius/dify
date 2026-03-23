"""
Internal response session management for response coordinator.

This module contains the private ResponseSession class used internally
by ResponseStreamCoordinator to manage streaming sessions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, cast

from dify_graph.nodes.base.template import Template
from dify_graph.runtime.graph_runtime_state import NodeProtocol


class _ResponseSessionNodeProtocol(NodeProtocol, Protocol):
    """Structural contract required from nodes that can open a response session."""

    def get_streaming_template(self) -> Template: ...


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
        At runtime this must be a node that implements `get_streaming_template()`. The coordinator decides which
        graph nodes should be treated as response-capable before they reach this factory.

        Args:
            node: Node from the materialized workflow graph.

        Returns:
            ResponseSession configured with the node's streaming template

        Raises:
            TypeError: If node does not implement the response-session streaming contract.
        """
        response_node = cast(_ResponseSessionNodeProtocol, node)
        try:
            template = response_node.get_streaming_template()
        except AttributeError as exc:
            raise TypeError("ResponseSession.from_node requires get_streaming_template() on response nodes") from exc

        return cls(
            node_id=node.id,
            template=template,
        )

    def is_complete(self) -> bool:
        """Check if all segments in the template have been processed."""
        return self.index >= len(self.template.segments)
