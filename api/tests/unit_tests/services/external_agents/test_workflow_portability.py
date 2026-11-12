import json
from typing import TypedDict

import pytest

from services.external_agents.io_contracts import JsonObject
from services.external_agents.workflow_portability import (
    ExternalReference,
    import_graph,
    portable_node,
    rebind_graph,
    reference_value,
)


class GraphNode(TypedDict):
    id: str
    position: dict[str, int]
    data: JsonObject


class Graph(TypedDict):
    nodes: list[GraphNode]
    edges: list[JsonObject]


def node(
    identifier: str, *, agent_id: str | None = None, reference: JsonObject | None = None, epoch: str | None = None
) -> GraphNode:
    return {
        "id": identifier,
        "position": {"x": 1, "y": 2},
        "data": {
            "type": "agent",
            "version": "2",
            "agent_node_kind": "external_a2a",
            "title": "Original name",
            "agent_task": f"task-{identifier}",
            "agent_declared_outputs": [{"name": "text", "type": "string"}],
            "external_wait": {"enabled": False, "on_timeout": "end_waiting"},
            "error_strategy": "fail-branch",
            "agent_binding": {
                "binding_type": "roster_agent",
                "agent_id": agent_id,
                "binding_epoch": epoch,
                "original_reference": reference,
            },
            "endpoint": "https://private.example",
            "authorization": "Bearer private",
            "contextId": "private-context",
            "taskId": "private-task",
            "connectionRevision": "private-revision",
            "agent_soul": {"secret": "private"},
        },
    }


def test_portable_allowlist_preserves_jobs_without_connections_or_implicit_null_defaults() -> None:
    reference = reference_value(workspace_id="source", agent_id="source-asset", name="Old name")
    data = node("one", agent_id="source-asset", reference=reference, epoch="old-epoch")["data"]
    result = portable_node(data, reference=reference)
    encoded = json.dumps(result)
    for forbidden in ("private", "old-epoch", "endpoint", "authorization", "connectionRevision", "agent_soul"):
        assert forbidden not in encoded
    assert result["agent_task"] == "task-one"
    assert "default_value" not in result["agent_declared_outputs"][0]
    assert result["external_wait"] == {"enabled": False, "on_timeout": "end_waiting"}
    assert portable_node(result, reference=reference) == result


@pytest.mark.parametrize(
    ("workspace", "allowed", "bound"), [("source", True, True), ("source", False, False), ("other", True, False)]
)
def test_import_restores_only_the_exact_same_workspace_accessible_reference(
    workspace: str, allowed: bool, bound: bool
) -> None:
    reference = reference_value(workspace_id="source", agent_id="source-asset", name="Old name")
    graph: Graph = {
        "nodes": [node("one", agent_id="source-asset", reference=reference, epoch="old")],
        "edges": [{"source": "one", "target": "end"}],
    }
    calls: list[str] = []

    def selectable(identifier: str) -> bool:
        calls.append(identifier)
        return allowed

    result, missing = import_graph(graph, workspace_id=workspace, selectable=selectable, new_epoch=lambda: "new")
    binding = result["nodes"][0]["data"]["agent_binding"]
    assert bool(binding.get("agent_id")) is bound
    assert missing == (() if bound else ("one",))
    assert result["edges"] == graph["edges"]
    assert result["nodes"][0]["position"] == graph["nodes"][0]["position"]
    assert calls == (["source-asset"] if workspace == "source" else [])
    if not bound:
        again, _missing = import_graph(result, workspace_id=workspace, selectable=selectable, new_epoch=lambda: "new")
        assert again == result


def test_rebind_defaults_to_matching_unconnected_nodes_without_touching_jobs_or_edges() -> None:
    source = reference_value(workspace_id="source", agent_id="a", name="A")
    other = reference_value(workspace_id="source", agent_id="different", name="A")
    graph: Graph = {
        "nodes": [
            node("one", reference=source),
            node("two", reference=source),
            node("connected", agent_id="a", reference=source, epoch="keep"),
            node("other", reference=other),
        ],
        "edges": [{"source": "two", "target": "connected", "data": {"selector": ["two", "text"]}}],
    }
    target = ExternalReference(workspace_id="current", agent_id="b", display_name="B")
    result, selected = rebind_graph(
        graph, node_id="one", target=target, include_matching=True, new_epoch=lambda: "fresh"
    )
    assert selected == ("one", "two")
    assert result["edges"] == graph["edges"]
    for before, after in zip(graph["nodes"], result["nodes"], strict=True):
        assert {key: value for key, value in before["data"].items() if key != "agent_binding"} == {
            key: value for key, value in after["data"].items() if key != "agent_binding"
        }
    assert result["nodes"][2] == graph["nodes"][2]
    assert result["nodes"][3] == graph["nodes"][3]
    _only, selected = rebind_graph(
        graph, node_id="one", target=target, include_matching=False, new_epoch=lambda: "fresh"
    )
    assert selected == ("one",)
