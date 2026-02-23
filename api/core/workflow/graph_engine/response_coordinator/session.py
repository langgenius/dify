"""
Internal response session management for response coordinator.

This module contains the private ResponseSession class used internally
by ResponseStreamCoordinator to manage streaming sessions.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.knowledge_index import KnowledgeIndexNode
from core.workflow.runtime.graph_runtime_state import NodeProtocol


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

        The parameter is typed as `NodeProtocol` because the graph is exposed behind a protocol at the runtime layer,
        but at runtime this must be an `AnswerNode`, `EndNode`, or `KnowledgeIndexNode` that provides:
        - `id: str`
        - `get_streaming_template() -> Template`

        Args:
            node: Node from the materialized workflow graph.

        Returns:
            ResponseSession configured with the node's streaming template

        Raises:
            TypeError: If node is not a supported response node type.
        """
        if not isinstance(node, AnswerNode | EndNode | KnowledgeIndexNode):
            raise TypeError("ResponseSession.from_node only supports AnswerNode, EndNode, or KnowledgeIndexNode")
        return cls(
            node_id=node.id,
            template=node.get_streaming_template(),
        )

    def is_complete(self) -> bool:
        """Check if all segments in the template have been processed."""
        return self.index >= len(self.template.segments)
