"""Unit tests for response session creation."""

from __future__ import annotations

import pytest

import dify_graph.graph_engine.response_coordinator.session as response_session_module
from dify_graph.enums import BuiltinNodeTypes, NodeExecutionType, NodeState, NodeType
from dify_graph.graph_engine.response_coordinator import RESPONSE_SESSION_NODE_TYPES
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


def test_response_session_from_node_rejects_node_types_outside_allowlist() -> None:
    """Unsupported node types are rejected even if they expose a template."""
    node = DummyResponseNode(
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        template=Template(segments=[TextSegment(text="hello")]),
    )

    with pytest.raises(TypeError, match="RESPONSE_SESSION_NODE_TYPES"):
        ResponseSession.from_node(node)


def test_response_session_from_node_supports_downstream_allowlist_extension(monkeypatch) -> None:
    """Downstream applications can extend the supported node-type list."""
    node = DummyResponseNode(
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        template=Template(segments=[TextSegment(text="hello")]),
    )
    extended_node_types = [*RESPONSE_SESSION_NODE_TYPES, BuiltinNodeTypes.LLM]
    monkeypatch.setattr(response_session_module, "RESPONSE_SESSION_NODE_TYPES", extended_node_types)

    session = ResponseSession.from_node(node)

    assert session.node_id == "llm-node"
    assert session.template.segments == [TextSegment(text="hello")]


def test_response_session_from_node_requires_streaming_template_method() -> None:
    """Allowed node types still need to implement the streaming-template contract."""
    node = DummyNodeWithoutStreamingTemplate(node_id="answer-node", node_type=BuiltinNodeTypes.ANSWER)

    with pytest.raises(TypeError, match="get_streaming_template"):
        ResponseSession.from_node(node)
