from unittest.mock import MagicMock

import pytest

from core.workflow.enums import NodeType
from core.workflow.graph import Graph
from core.workflow.nodes.base.node import Node


def _make_node(node_id: str, node_type: NodeType = NodeType.START) -> Node:
    node = MagicMock(spec=Node)
    node.id = node_id
    node.node_type = node_type
    node.execution_type = None  # attribute not used in builder path
    return node


def test_graph_builder_creates_linear_graph():
    builder = Graph.new()
    root = _make_node("root", NodeType.START)
    mid = _make_node("mid", NodeType.LLM)
    end = _make_node("end", NodeType.END)

    graph = builder.add_root(root).add_node(mid).add_node(end).build()

    assert graph.root_node is root
    assert graph.nodes == {"root": root, "mid": mid, "end": end}
    assert len(graph.edges) == 2
    first_edge = next(iter(graph.edges.values()))
    assert first_edge.tail == "root"
    assert first_edge.head == "mid"
    assert graph.out_edges["mid"] == [edge_id for edge_id, edge in graph.edges.items() if edge.tail == "mid"]


def test_graph_builder_supports_custom_predecessor():
    builder = Graph.new()
    root = _make_node("root")
    branch = _make_node("branch")
    other = _make_node("other")

    graph = builder.add_root(root).add_node(branch).add_node(other, from_node_id="root").build()

    outgoing_root = graph.out_edges["root"]
    assert len(outgoing_root) == 2
    edge_targets = {graph.edges[eid].head for eid in outgoing_root}
    assert edge_targets == {"branch", "other"}


def test_graph_builder_validates_usage():
    builder = Graph.new()
    node = _make_node("node")

    with pytest.raises(ValueError, match="Root node"):
        builder.add_node(node)

    builder.add_root(node)
    duplicate = _make_node("node")
    with pytest.raises(ValueError, match="Duplicate"):
        builder.add_node(duplicate)
