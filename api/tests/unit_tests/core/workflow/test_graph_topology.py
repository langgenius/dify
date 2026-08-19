"""Unit tests for the shared workflow graph topology helper (ENG-615)."""

from __future__ import annotations

from core.workflow.graph_topology import WorkflowGraphTopology

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


def test_upstream_node_ids_collects_all_ancestors_excluding_ghosts():
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("agent") == {"start", "llm-1", "llm-2"}


def test_upstream_node_ids_differ_per_target_node():
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("llm-1") == {"start"}
    assert topology.upstream_node_ids("end") == {"start", "llm-1", "llm-2", "agent"}
    assert topology.upstream_node_ids("start") == set()


def test_is_upstream_kept_for_publish_validation():
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.is_upstream(source_node_id="start", target_node_id="end")
    assert not topology.is_upstream(source_node_id="end", target_node_id="start")


def test_cycle_safe():
    graph = {
        "nodes": [{"id": "a"}, {"id": "b"}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    topology = WorkflowGraphTopology.from_graph(graph)
    assert topology.upstream_node_ids("a") == {"b"}
