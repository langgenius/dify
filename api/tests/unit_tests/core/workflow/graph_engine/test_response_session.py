"""Unit tests for response session creation."""

from __future__ import annotations

import pytest

from dify_graph.enums import BuiltinNodeTypes, NodeExecutionType, NodeState, NodeType
from dify_graph.graph_engine.response_coordinator.session import ResponseSession
from dify_graph.nodes.base.template import Template, TextSegment


class DummyResponseNode:
    """Minimal response-capable node for session tests."""

    def __init__(self, *, node_id: str, node_type: NodeType, template: Template) -> None:
        self.id = node_id
        self.node_type = node_type
        self.execution_type = NodeExecutionType.RESPONSE
        self.state = NodeState.UNKNOWN
        self._template = template

    def get_streaming_template(self) -> Template:
        return self._template


class DummyNodeWithoutStreamingTemplate:
    """Minimal node that violates the response-session contract."""

    def __init__(self, *, node_id: str, node_type: NodeType) -> None:
        self.id = node_id
        self.node_type = node_type
        self.execution_type = NodeExecutionType.RESPONSE
        self.state = NodeState.UNKNOWN


def test_response_session_from_node_accepts_nodes_outside_previous_allowlist() -> None:
    """Session creation depends on the streaming-template contract rather than node type."""
    node = DummyResponseNode(
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        template=Template(segments=[TextSegment(text="hello")]),
    )

    session = ResponseSession.from_node(node)

    assert session.node_id == "llm-node"
    assert session.template.segments == [TextSegment(text="hello")]


def test_response_session_from_node_requires_streaming_template_method() -> None:
    """Allowed node types still need to implement the streaming-template contract."""
    node = DummyNodeWithoutStreamingTemplate(node_id="answer-node", node_type=BuiltinNodeTypes.ANSWER)

    with pytest.raises(TypeError, match="get_streaming_template"):
        ResponseSession.from_node(node)
