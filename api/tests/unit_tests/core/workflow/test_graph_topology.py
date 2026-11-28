"""Unit tests for the shared workflow graph topology helper (ENG-615)."""

from __future__ import annotations

from core.workflow.graph_topology import (
    WorkflowGraph,
    WorkflowGraphTopology,
    parse_workflow_graph,
)

_GRAPH: WorkflowGraph = {
    "nodes": [
        {"id": "start", "data": {}},
        {"id": "llm-1", "data": {}},
        {"id": "llm-2", "data": {}},
        {"id": "agent", "data": {}},
        {"id": "end", "data": {}},
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
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("agent") == {"start", "llm-1", "llm-2"}


def test_upstream_node_ids_differ_per_target_node() -> None:
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.upstream_node_ids("llm-1") == {"start"}
    assert topology.upstream_node_ids("end") == {"start", "llm-1", "llm-2", "agent"}
    assert topology.upstream_node_ids("start") == set()


def test_is_upstream_kept_for_publish_validation() -> None:
    topology = WorkflowGraphTopology.from_graph(_GRAPH)
    assert topology.is_upstream(source_node_id="start", target_node_id="end")
    assert not topology.is_upstream(source_node_id="end", target_node_id="start")


def test_cycle_safe() -> None:
    graph: WorkflowGraph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    topology = WorkflowGraphTopology.from_graph(graph)
    assert topology.upstream_node_ids("a") == {"b"}


def test_parse_workflow_graph_drops_entries_that_are_not_nodes_or_edges() -> None:
    graph = parse_workflow_graph(
        {
            "nodes": [
                {"id": "start", "data": {"type": "start"}, "legacy": True},
                {"id": "empty-data"},
                {"id": "non-mapping-data", "data": None},
                {"data": {"type": "llm"}},
                "not-a-node",
            ],
            "edges": [
                {"source": "start", "target": "end", "legacy": True},
                {"source": "start"},
                {"source": 1, "target": "end"},
                "not-an-edge",
            ],
        }
    )

    assert graph["nodes"] == [
        {"id": "start", "data": {"type": "start"}},
        {"id": "empty-data", "data": {}},
        {"id": "non-mapping-data", "data": {}},
    ]
    assert graph["edges"] == [{"source": "start", "target": "end"}]


def test_parse_workflow_graph_tolerates_missing_sections() -> None:
    assert parse_workflow_graph({}) == {"nodes": [], "edges": []}
    assert parse_workflow_graph({"nodes": None, "edges": {}}) == {"nodes": [], "edges": []}
