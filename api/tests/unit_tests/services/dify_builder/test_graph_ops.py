"""Tests for the pure client-side graph mutation used by ``apply_repair``.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole graph. ``apply_set_node_config`` is the local mutation the
adapter applies to a freshly-read graph before writing it all back, mirroring
the placeholder agent's ``set_node_config{node_id, path: "code", value}``
intents (see core/dify_builder/placeholder_agent.py).
"""

import copy

import pytest

from core.dify_builder.models import MutationIntent
from services.dify_builder import graph_ops
from services.dify_builder.graph_ops import (
    MUTATION_ARG_KEYS,
    apply_connect,
    apply_create_node,
    apply_delete_node,
    apply_insert_between,
    apply_set_node_config,
    diff_graphs,
    validate_intent_args,
)

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
    assert "x" in node["position"]
    assert "y" in node["position"]


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


def test_apply_create_node_explicit_empty_position_is_kept_not_defaulted():
    graph = {"nodes": [], "edges": []}

    new_graph, _changed = apply_create_node(graph, "llm", {}, position={})

    assert new_graph["nodes"][0]["position"] == {}


# ---- apply_delete_node ------------------------------------------------------


def test_apply_delete_node_removes_node_and_its_edges():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b", "type": "custom"}],
    }

    new_graph, changed = apply_delete_node(graph, "a")

    assert changed == ["a"]
    assert [n["id"] for n in new_graph["nodes"]] == ["b"]
    assert new_graph["edges"] == []


def test_apply_delete_node_leaves_unrelated_edges():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}, {"id": "c", "data": {}}],
        "edges": [{"id": "e1", "source": "b", "target": "c", "type": "custom"}],
    }

    new_graph, _changed = apply_delete_node(graph, "a")

    assert len(new_graph["edges"]) == 1


def test_apply_delete_node_missing_id_raises_value_error():
    graph = {"nodes": [{"id": "a", "data": {}}], "edges": []}

    with pytest.raises(ValueError):
        apply_delete_node(graph, "does-not-exist")


def test_apply_delete_node_original_graph_untouched():
    graph = {"nodes": [{"id": "a", "data": {}}], "edges": []}

    apply_delete_node(graph, "a")

    assert graph["nodes"] == [{"id": "a", "data": {}}]


# ---- apply_connect -----------------------------------------------------------


def test_apply_connect_adds_a_graph_edge_dict_shaped_edge_with_default_handles():
    graph = {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}], "edges": []}

    new_graph, changed = apply_connect(graph, "a", "b")

    assert changed == ["a", "b"]
    assert len(new_graph["edges"]) == 1
    edge = new_graph["edges"][0]
    assert edge["source"] == "a"
    assert edge["target"] == "b"
    assert edge["type"] == "custom"
    assert edge["sourceHandle"] == "source"
    assert edge["targetHandle"] == "target"
    assert edge["id"]


def test_apply_connect_honors_explicit_handles():
    graph = {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}], "edges": []}

    new_graph, _changed = apply_connect(graph, "a", "b", source_handle="true", target_handle="target")

    assert new_graph["edges"][0]["sourceHandle"] == "true"


def test_apply_connect_raises_on_dangling_from_node():
    graph = {"nodes": [{"id": "b", "data": {}}], "edges": []}

    with pytest.raises(ValueError):
        apply_connect(graph, "does-not-exist", "b")


def test_apply_connect_raises_on_dangling_to_node():
    graph = {"nodes": [{"id": "a", "data": {}}], "edges": []}

    with pytest.raises(ValueError):
        apply_connect(graph, "a", "does-not-exist")


def test_apply_connect_original_graph_untouched():
    graph = {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}], "edges": []}

    apply_connect(graph, "a", "b")

    assert graph["edges"] == []


# ---- apply_insert_between -------------------------------------------------------


def test_apply_insert_between_splits_the_matched_edge_around_a_new_node():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [
            {
                "id": "e1",
                "source": "a",
                "target": "b",
                "type": "custom",
                "sourceHandle": "source",
                "targetHandle": "target",
            }
        ],
    }

    new_graph, changed = apply_insert_between(graph, {"source": "a", "target": "b"}, "llm", {})

    new_id = changed[0]
    assert [n["id"] for n in new_graph["nodes"]] == ["a", "b", new_id]
    edge_pairs = [(e["source"], e["target"]) for e in new_graph["edges"]]
    assert ("a", "b") not in edge_pairs
    assert ("a", new_id) in edge_pairs
    assert (new_id, "b") in edge_pairs
    assert len(new_graph["edges"]) == 2


def test_apply_insert_between_preserves_original_edge_handles_at_the_ends():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [
            {
                "id": "e1",
                "source": "a",
                "target": "b",
                "type": "custom",
                "sourceHandle": "true",
                "targetHandle": "target",
            }
        ],
    }

    new_graph, changed = apply_insert_between(graph, {"source": "a", "target": "b"}, "llm", {})

    new_id = changed[0]
    incoming = next(e for e in new_graph["edges"] if e["target"] == new_id)
    outgoing = next(e for e in new_graph["edges"] if e["source"] == new_id)
    assert incoming["sourceHandle"] == "true"
    assert outgoing["targetHandle"] == "target"


def test_apply_insert_between_raises_when_edge_not_found():
    graph = {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}], "edges": []}

    with pytest.raises(ValueError):
        apply_insert_between(graph, {"source": "a", "target": "b"}, "llm", {})


def test_apply_insert_between_honors_explicit_node_id_and_position():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b", "type": "custom"}],
    }

    new_graph, changed = apply_insert_between(
        graph, {"source": "a", "target": "b"}, "llm", {}, position={"x": 1.0, "y": 2.0}, node_id="my-llm"
    )

    assert changed == ["my-llm"]
    new_node = next(n for n in new_graph["nodes"] if n["id"] == "my-llm")
    assert new_node["position"] == {"x": 1.0, "y": 2.0}


def test_apply_insert_between_original_graph_untouched():
    graph = {
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b", "type": "custom"}],
    }

    apply_insert_between(graph, {"source": "a", "target": "b"}, "llm", {})

    assert len(graph["edges"]) == 1
    assert graph["edges"][0]["target"] == "b"


# ---- diff_graphs -------------------------------------------------------


def test_diff_graphs_added_node_and_edge_is_structure_scope():
    before = {"nodes": [{"id": "a", "data": {}}], "edges": []}
    after = {
        "nodes": [{"id": "a", "data": {}}, {"id": "knowledge-1", "data": {}}],
        "edges": [{"source": "knowledge-1", "target": "a", "sourceHandle": "source", "targetHandle": "target"}],
    }

    changes, scope = diff_graphs(before, after)

    assert scope == "structure"
    assert "added node knowledge-1" in changes
    assert "added knowledge-1 → a" in changes


def test_diff_graphs_removed_node_is_structure_scope():
    before = {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}], "edges": []}
    after = {"nodes": [{"id": "b", "data": {}}], "edges": []}

    changes, scope = diff_graphs(before, after)

    assert scope == "structure"
    assert changes == ["removed node a"]


def test_diff_graphs_config_only_change_is_configuration_scope():
    before = {"nodes": [{"id": "llm-1", "data": {"prompt_template": "old"}}], "edges": []}
    after = {"nodes": [{"id": "llm-1", "data": {"prompt_template": "new"}}], "edges": []}

    changes, scope = diff_graphs(before, after)

    assert scope == "configuration"
    assert changes == ["llm-1: prompt_template updated"]


def test_diff_graphs_no_changes_is_configuration_scope_with_empty_changes():
    graph = {"nodes": [{"id": "a", "data": {"x": 1}}], "edges": []}

    changes, scope = diff_graphs(graph, copy.deepcopy(graph))

    assert changes == []
    assert scope == "configuration"


# ---- structural_fingerprint -------------------------------------------------------


def test_structural_fingerprint_is_config_insensitive():
    from services.dify_builder.graph_ops import structural_fingerprint

    g1 = {
        "nodes": [{"id": "a", "type": "custom", "data": {"type": "llm", "model": "gpt-4"}}],
        "edges": [],
    }
    g2 = {
        "nodes": [{"id": "a", "type": "custom", "data": {"type": "llm", "model": "claude"}}],
        "edges": [],
    }
    # Same nodes/edges, different node config -> same fingerprint.
    assert structural_fingerprint(g1) == structural_fingerprint(g2)


def test_structural_fingerprint_changes_on_structure():
    from services.dify_builder.graph_ops import structural_fingerprint

    base = {"nodes": [{"id": "a", "data": {"type": "llm"}}], "edges": []}
    add_node = {
        "nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "end"}}],
        "edges": [],
    }
    add_edge = {
        "nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "end"}}],
        "edges": [{"source": "a", "target": "b", "sourceHandle": "source", "targetHandle": "target"}],
    }
    assert structural_fingerprint(base) != structural_fingerprint(add_node)
    assert structural_fingerprint(add_node) != structural_fingerprint(add_edge)


def test_structural_fingerprint_is_order_independent():
    from services.dify_builder.graph_ops import structural_fingerprint

    g1 = {"nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "end"}}], "edges": []}
    g2 = {"nodes": [{"id": "b", "data": {"type": "end"}}, {"id": "a", "data": {"type": "llm"}}], "edges": []}
    assert structural_fingerprint(g1) == structural_fingerprint(g2)


def test_structural_fingerprint_handles_empty_and_missing_keys():
    from services.dify_builder.graph_ops import structural_fingerprint

    assert isinstance(structural_fingerprint({}), str)
    assert structural_fingerprint({}) == structural_fingerprint({"nodes": [], "edges": []})


# ---- node_ids -------------------------------------------------------


def test_node_ids():
    from services.dify_builder.graph_ops import node_ids

    g = {"nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "end"}}], "edges": []}
    assert node_ids(g) == ["a", "b"]
    assert node_ids({}) == []


# ---- filter_applicable -------------------------------------------------------


_G = {
    "nodes": [
        {"id": "a", "type": "custom", "data": {"type": "code", "title": "Code"}},
        {"id": "b", "type": "custom", "data": {"type": "end", "title": "End"}},
    ],
    "edges": [{"id": "a-b", "source": "a", "target": "b"}],
}


def test_filter_applicable_all_valid():
    intents = [MutationIntent(op="set_node_config", args={"node_id": "a", "path": "code", "value": "x"})]
    ok, bad = graph_ops.filter_applicable(_G, intents)
    assert ok == intents
    assert bad == []


def test_filter_rejects_unknown_op():
    intents = [MutationIntent(op="frobnicate", args={})]
    ok, bad = graph_ops.filter_applicable(_G, intents)
    assert ok == []
    assert "unknown mutation op" in bad[0][1]


def test_filter_rejects_missing_required_arg():
    intents = [MutationIntent(op="set_node_config", args={"node_id": "a"})]
    ok, bad = graph_ops.filter_applicable(_G, intents)
    assert ok == []
    assert "missing required arg" in bad[0][1]


def test_filter_rejects_extra_arg_key():
    intents = [MutationIntent(op="delete_node", args={"node_id": "a", "bogus": 1})]
    ok, bad = graph_ops.filter_applicable(_G, intents)
    assert ok == []
    assert "bogus" in bad[0][1]


def test_filter_rejects_dangling_ref():
    intents = [MutationIntent(op="connect", args={"from_node": "a", "to_node": "zzz"})]
    ok, bad = graph_ops.filter_applicable(_G, intents)
    assert ok == []
    assert "node not found" in bad[0][1]


def test_filter_rejects_unknown_node_type():
    intents = [MutationIntent(op="create_node", args={"node_type": "made-up", "config": {}})]
    ok, bad = graph_ops.filter_applicable(_G, intents, allowed_node_types={"llm", "end"})
    assert ok == []
    assert "node_type not allowed" in bad[0][1]


def test_filter_create_then_connect_ordering():
    intents = [
        MutationIntent(op="create_node", args={"node_type": "llm", "config": {}, "node_id": "c"}),
        MutationIntent(op="connect", args={"from_node": "c", "to_node": "b"}),
    ]
    ok, bad = graph_ops.filter_applicable(_G, intents, allowed_node_types={"llm", "end"})
    assert ok == intents  # the connect sees the node the prior create added
    assert bad == []
