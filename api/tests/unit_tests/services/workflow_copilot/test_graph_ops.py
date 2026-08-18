"""Tests for the pure client-side graph mutation used by ``apply_repair``.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole graph. ``apply_set_node_config`` is the local mutation the
adapter applies to a freshly-read graph before writing it all back, mirroring
the placeholder agent's ``set_node_config{node_id, path: "code", value}``
intents (see core/workflow_copilot/placeholder_agent.py).
"""

import pytest

from services.workflow_copilot.graph_ops import apply_set_node_config


def _two_node_graph() -> dict:
    return {
        "nodes": [
            {"id": "node-1", "data": {"code": "old code", "title": "Code"}},
            {"id": "node-2", "data": {"code": "other", "title": "Other"}},
        ],
        "edges": [],
    }


def test_sets_target_node_data_path_and_reports_changed_node():
    graph = _two_node_graph()

    new_graph, changed = apply_set_node_config(graph, "node-1", "code", "new code")

    assert changed == ["node-1"]
    target = next(n for n in new_graph["nodes"] if n["id"] == "node-1")
    assert target["data"]["code"] == "new code"


def test_only_target_node_changes_other_nodes_untouched():
    graph = _two_node_graph()

    new_graph, _changed = apply_set_node_config(graph, "node-1", "code", "new code")

    other = next(n for n in new_graph["nodes"] if n["id"] == "node-2")
    assert other["data"]["code"] == "other"
    assert other["data"]["title"] == "Other"


def test_original_graph_object_is_untouched_proves_deep_copy():
    graph = _two_node_graph()

    apply_set_node_config(graph, "node-1", "code", "new code")

    assert graph["nodes"][0]["data"]["code"] == "old code"


def test_missing_node_id_raises_value_error():
    graph = _two_node_graph()

    with pytest.raises(ValueError):
        apply_set_node_config(graph, "does-not-exist", "code", "new code")
