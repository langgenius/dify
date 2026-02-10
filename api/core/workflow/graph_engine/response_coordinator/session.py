"""
Internal response session management for response coordinator.

This module contains the private ResponseSession class used internally
by ResponseStreamCoordinator to manage streaming sessions.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.knowledge_index import KnowledgeIndexNode


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
    def from_node(cls, node: Node) -> ResponseSession:
        """
        Create a ResponseSession from an AnswerNode or EndNode.

        Args:
            node: Must be either an AnswerNode or EndNode instance

        Returns:
            ResponseSession configured with the node's streaming template

        Raises:
            TypeError: If node is not an AnswerNode or EndNode
        """
        if not isinstance(node, AnswerNode | EndNode | KnowledgeIndexNode):
            raise TypeError
        return cls(
            node_id=node.id,
            template=node.get_streaming_template(),
        )

    def is_complete(self) -> bool:
        """Check if all segments in the template have been processed."""
        return self.index >= len(self.template.segments)
