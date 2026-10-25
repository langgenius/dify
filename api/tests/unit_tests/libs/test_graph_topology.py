"""Unit tests for serialized graph topology and containment visibility."""

from __future__ import annotations

from libs.graph_topology import GraphTopology

_GRAPH = {
    "nodes": [
        {"id": "start"},
        {"id": "llm-1"},
        {"id": "llm-2"},
        {"id": "agent"},
        {"id": "end"},
    ],
    "edges": [
        {"source": "start", "target": "llm-1"},
        {"source": "start", "target": "llm-2"},
        {"source": "llm-1", "target": "agent"},
        {"source": "llm-2", "target": "agent"},
        {"source": "agent", "target": "end"},
        # ghost edge: source node was deleted from nodes[]
        {"source": "ghost", "target": "agent"},
    ],
}


def test_upstream_node_ids_collects_all_ancestors_excluding_ghosts() -> None:
    topology = GraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("agent") == {"start", "llm-1", "llm-2"}


def test_upstream_node_ids_differ_per_target_node() -> None:
    topology = GraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("llm-1") == {"start"}
    assert topology.upstream_node_ids("end") == {"start", "llm-1", "llm-2", "agent"}
    assert topology.upstream_node_ids("start") == set()


def test_is_upstream_kept_for_publish_validation() -> None:
    topology = GraphTopology.from_graph(_GRAPH)
    assert topology.is_upstream(source_node_id="start", target_node_id="end")
    assert not topology.is_upstream(source_node_id="end", target_node_id="start")


def test_cycle_safe() -> None:
    graph = {
        "nodes": [{"id": "a"}, {"id": "b"}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    topology = GraphTopology.from_graph(graph)
    assert topology.upstream_node_ids("a") == {"b"}


def test_nested_containment_inherits_only_ancestor_scopes() -> None:
    graph = {
        "nodes": [
            {"id": "start"},
            {"id": "outer"},
            {"id": "inner", "parentId": "outer"},
            {"id": "agent", "parentId": "inner"},
            {"id": "sibling", "parentId": "inner"},
            {"id": "other"},
            {"id": "other-child", "parentId": "other"},
            {"id": "later"},
        ],
        "edges": [{"source": "start", "target": "outer"}, {"source": "outer", "target": "later"}],
    }
    topology = GraphTopology.from_graph(graph)
    assert topology.upstream_node_ids("agent") == {"start", "outer", "inner"}
    for source in ("start", "outer", "inner"):
        assert topology.is_upstream(source_node_id=source, target_node_id="agent")
    for source in ("agent", "sibling", "other", "other-child", "later"):
        assert not topology.is_upstream(source_node_id=source, target_node_id="agent")
    assert topology.upstream_node_ids("later") == {"start", "outer"}
    assert not topology.is_upstream(source_node_id="agent", target_node_id="outer")


def test_missing_or_self_parent_does_not_create_an_ancestor() -> None:
    topology = GraphTopology.from_graph(
        {
            "nodes": [{"id": "missing", "parentId": "deleted"}, {"id": "self", "parentId": "self"}],
            "edges": [],
        }
    )
    assert topology.upstream_node_ids("missing") == set()
    assert topology.upstream_node_ids("self") == set()
