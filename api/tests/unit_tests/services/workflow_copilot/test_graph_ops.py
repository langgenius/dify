"""Tests for the pure client-side graph mutation used by ``apply_repair``.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole graph. ``apply_set_node_config`` is the local mutation the
adapter applies to a freshly-read graph before writing it all back, mirroring
the placeholder agent's ``set_node_config{node_id, path: "code", value}``
intents (see core/workflow_copilot/placeholder_agent.py).
"""

import pytest

from core.workflow_copilot.models import MutationIntent
from services.workflow_copilot.graph_ops import MUTATION_ARG_KEYS, apply_create_node, apply_set_node_config, validate_intent_args


# ---- validate_intent_args --------------------------------------------------


@pytest.mark.parametrize(
    ("op", "args"),
    [
        ("set_node_config", {"node_id": "n1", "path": "code", "value": "x"}),
        ("create_node", {"node_type": "llm", "config": {}}),
        ("delete_node", {"node_id": "n1"}),
        ("connect", {"from_node": "n1", "to_node": "n2"}),
        ("insert_between", {"edge": {"source": "n1", "target": "n2"}, "node_type": "llm", "config": {}}),
    ],
)
def test_validate_intent_args_accepts_each_op_with_its_required_keys(op, args):
    validate_intent_args(MutationIntent(op=op, args=args))  # must not raise


@pytest.mark.parametrize(
    ("op", "args", "missing_key"),
    [
        ("set_node_config", {"node_id": "n1", "path": "code"}, "value"),
        ("create_node", {"config": {}}, "node_type"),
        ("delete_node", {}, "node_id"),
        ("connect", {"from_node": "n1"}, "to_node"),
        ("insert_between", {"node_type": "llm", "config": {}}, "edge"),
    ],
)
def test_validate_intent_args_raises_on_missing_required_key(op, args, missing_key):
    with pytest.raises(ValueError, match=missing_key):
        validate_intent_args(MutationIntent(op=op, args=args))


def test_validate_intent_args_raises_on_unknown_op():
    with pytest.raises(ValueError, match="unknown mutation op"):
        validate_intent_args(MutationIntent(op="not_a_real_verb", args={}))


def test_mutation_arg_keys_covers_all_five_verbs():
    assert set(MUTATION_ARG_KEYS) == {
        "set_node_config",
        "create_node",
        "delete_node",
        "connect",
        "insert_between",
    }


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


# ---- apply_create_node ------------------------------------------------------


def test_apply_create_node_appends_a_graph_node_dict_shaped_node():
    graph = {"nodes": [], "edges": []}

    new_graph, changed = apply_create_node(graph, "start", {"variables": []})

    assert len(new_graph["nodes"]) == 1
    node = new_graph["nodes"][0]
    assert changed == [node["id"]]
    assert node["type"] == "custom"
    assert node["data"]["type"] == "start"
    assert node["data"]["variables"] == []
    assert node["data"]["title"] == node["id"]
    assert node["data"]["desc"] == ""
    assert node["data"]["selected"] is False
    assert "x" in node["position"] and "y" in node["position"]


def test_apply_create_node_generates_id_from_node_type_with_collision_suffix():
    graph = {"nodes": [{"id": "llm", "data": {"type": "llm"}}], "edges": []}

    new_graph, changed = apply_create_node(graph, "llm", {})

    assert changed == ["llm_2"]
    assert new_graph["nodes"][-1]["id"] == "llm_2"


def test_apply_create_node_honors_explicit_node_id():
    graph = {"nodes": [], "edges": []}

    new_graph, changed = apply_create_node(graph, "llm", {}, node_id="my-llm")

    assert changed == ["my-llm"]
    assert new_graph["nodes"][0]["id"] == "my-llm"


def test_apply_create_node_raises_on_duplicate_explicit_node_id():
    graph = {"nodes": [{"id": "my-llm", "data": {}}], "edges": []}

    with pytest.raises(ValueError):
        apply_create_node(graph, "llm", {}, node_id="my-llm")


def test_apply_create_node_uses_given_position_when_supplied():
    graph = {"nodes": [], "edges": []}

    new_graph, _changed = apply_create_node(graph, "llm", {}, position={"x": 42.0, "y": 7.0})

    assert new_graph["nodes"][0]["position"] == {"x": 42.0, "y": 7.0}


def test_apply_create_node_default_position_is_right_of_existing_nodes():
    graph = {"nodes": [{"id": "a", "position": {"x": 100.0, "y": 100.0}}], "edges": []}

    new_graph, _changed = apply_create_node(graph, "llm", {})

    assert new_graph["nodes"][-1]["position"]["x"] > 100.0


def test_apply_create_node_original_graph_untouched():
    graph = {"nodes": [], "edges": []}

    apply_create_node(graph, "llm", {})

    assert graph["nodes"] == []
