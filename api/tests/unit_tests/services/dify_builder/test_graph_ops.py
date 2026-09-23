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


def test_create_node_nests_a_child_under_its_parent():
    graph = {"nodes": [{"id": "iter1", "type": "custom", "data": {"type": "iteration"}}], "edges": []}
    out, changed = apply_create_node(
        graph,
        "llm",
        {"title": "Summarize"},
        position={"x": 300, "y": 220},
        node_id="child1",
        parent_id="iter1",
    )
    assert changed == ["child1"]
    child = next(n for n in out["nodes"] if n["id"] == "child1")
    assert child["parentId"] == "iter1"
    assert child["extent"] == "parent"
    assert child["zIndex"] == 1002
    assert child["position"] == {"x": 300, "y": 220}


def test_create_node_without_a_parent_carries_no_wrapper_keys():
    graph = {"nodes": [], "edges": []}
    out, _changed = apply_create_node(graph, "llm", {"title": "Top level"}, node_id="n1")
    node = out["nodes"][0]
    assert "parentId" not in node
    assert "extent" not in node
    assert "zIndex" not in node


def test_create_node_defaults_the_reactflow_type_to_custom():
    graph = {"nodes": [], "edges": []}
    out, _changed = apply_create_node(graph, "llm", {"title": "LLM"}, node_id="n1")
    assert out["nodes"][0]["type"] == "custom"


def test_create_node_carries_a_container_start_markers_reactflow_type():
    """The canvas resolves its component from the NODE-level type. A marker
    persisted as "custom" has no component and crashes it (ESQ1-288)."""
    graph = {"nodes": [], "edges": []}
    out, _changed = apply_create_node(
        graph,
        "iteration-start",
        {"title": ""},
        node_id="iter1start",
        parent_id="iter1",
        flow_type="custom-iteration-start",
    )
    node = out["nodes"][0]
    assert node["type"] == "custom-iteration-start"
    assert node["data"]["type"] == "iteration-start"
    assert node["parentId"] == "iter1"


# ---- node-type defaults at the create chokepoint ----------------------------


def test_create_node_fills_a_required_field_the_caller_left_out():
    """An LLM writes only the fields it was thinking about.
    ``TemplateTransformNodeData.variables`` is required with no default, so the
    draft preflight refused the WHOLE repair batch that created this node."""
    graph = {"nodes": [], "edges": []}

    out, _changed = apply_create_node(
        graph, "template-transform", {"title": "Excellent", "template": "excellent"}, node_id="n1"
    )

    data = out["nodes"][0]["data"]
    assert data["variables"] == []
    assert data["template"] == "excellent"
    assert data["title"] == "Excellent"


def test_create_node_never_overwrites_a_value_the_caller_supplied():
    """Defaults merge UNDER the config: the caller's value always wins."""
    supplied = [{"variable": "score", "value_selector": ["node1", "score"]}]
    graph = {"nodes": [], "edges": []}

    out, _changed = apply_create_node(
        graph, "template-transform", {"template": "{{ score }}", "variables": supplied}, node_id="n1"
    )

    assert out["nodes"][0]["data"]["variables"] == supplied


def test_create_node_defaults_do_not_alias_the_registry():
    """Two nodes created from the same default must not share one list."""
    graph = {"nodes": [], "edges": []}

    graph, _ = apply_create_node(graph, "template-transform", {"template": "a"}, node_id="n1")
    graph, _ = apply_create_node(graph, "template-transform", {"template": "b"}, node_id="n2")
    graph["nodes"][0]["data"]["variables"].append({"variable": "mutated", "value_selector": ["x"]})

    assert graph["nodes"][1]["data"]["variables"] == []


def test_create_node_leaves_a_generator_shaped_config_untouched():
    """Build's configs come from the generator and already spell every field
    out. Filling missing keys must not perturb one of them."""
    generator_config = {
        "title": "LLM",
        "desc": "",
        "selected": False,
        "model": {
            "provider": "langgenius/openai/openai",
            "name": "gpt-4o",
            "mode": "chat",
            "completion_params": {"temperature": 0.2},
        },
        "prompt_template": [{"role": "system", "text": "You are helpful.", "id": "p1"}],
        "context": {"enabled": True, "variable_selector": ["node1", "text"]},
        "vision": {"enabled": True, "configs": {"detail": "high"}},
    }
    graph = {"nodes": [], "edges": []}

    out, _changed = apply_create_node(graph, "llm", copy.deepcopy(generator_config), node_id="n1")

    data = out["nodes"][0]["data"]
    assert {k: v for k, v in data.items() if k != "type"} == generator_config
    assert data["type"] == "llm"


def test_create_node_adds_nothing_for_a_node_type_with_no_registered_defaults():
    """An unregistered type must contribute no defaults, not abort the edit."""
    graph = {"nodes": [], "edges": []}

    out, _changed = apply_create_node(graph, "iteration", {"title": "Loop over"}, node_id="n1")

    assert out["nodes"][0]["data"] == {
        "type": "iteration",
        "title": "Loop over",
        "desc": "",
        "selected": False,
    }


def test_insert_between_fills_required_fields_too():
    """``insert_between`` builds its node through the same chokepoint."""
    graph = {
        "nodes": [{"id": "a", "data": {"type": "start"}}, {"id": "b", "data": {"type": "end"}}],
        "edges": [{"id": "e1", "source": "a", "target": "b", "type": "custom"}],
    }

    out, changed = apply_insert_between(
        graph, {"source": "a", "target": "b"}, "code", {"code": "print(1)"}, node_id="n1"
    )

    assert changed == ["n1"]
    data = next(n for n in out["nodes"] if n["id"] == "n1")["data"]
    assert data["outputs"] == {}
    assert data["variables"] == []
    assert data["code_language"] == "python3"
    assert data["code"] == "print(1)"


def test_filter_applicable_routes_a_create_through_the_apply_fn_that_fills_defaults():
    """``filter_applicable`` does not return its working graph, so this cannot
    assert on the node the dry run built. What it CAN pin is the link that makes
    the dry run and the live apply agree: the dry run dispatches through
    ``APPLY_FNS``, whose ``create_node`` entry is the very function that merges
    the defaults in -- and it accepts a config that omits one."""
    intents = [
        MutationIntent(
            op="create_node",
            args={"node_type": "template-transform", "node_id": "n1", "config": {"template": "x"}},
        )
    ]

    applicable, rejected = graph_ops.filter_applicable({"nodes": [], "edges": []}, intents)

    assert rejected == []
    assert applicable == intents
    assert graph_ops.APPLY_FNS["create_node"] is graph_ops.apply_create_node
    built, _ = graph_ops.apply_create_node({"nodes": [], "edges": []}, **intents[0].args)
    assert built["nodes"][0]["data"]["variables"] == []


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


# ---- apply_connect: branch handles must be ones the node declares ----------
# (ESQ1-303) An edge on an undeclared handle hangs off nothing and its arm
# never runs; the run still reports "succeeded". Reject at the write.

_IF_ELSE = {"id": "branch", "data": {"type": "if-else", "cases": [{"case_id": "true", "conditions": []}]}}
_TARGET = {"id": "a", "data": {"type": "llm"}}


def test_apply_connect_accepts_a_declared_branch_handle():
    graph = {"nodes": [_IF_ELSE, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "branch", "a", source_handle="false")

    assert new_graph["edges"][0]["sourceHandle"] == "false"


def test_apply_connect_rejects_an_undeclared_branch_handle_and_names_the_declared_ones():
    graph = {"nodes": [_IF_ELSE, _TARGET], "edges": []}

    with pytest.raises(ValueError, match=r"branch node 'branch' has no handle 'else'.*\['true', 'false'\]"):
        apply_connect(graph, "branch", "a", source_handle="else")


def test_apply_connect_rejects_the_default_handle_on_a_branch_node():
    graph = {"nodes": [_IF_ELSE, _TARGET], "edges": []}

    with pytest.raises(ValueError, match="has no handle 'source'"):
        apply_connect(graph, "branch", "a")


def test_apply_connect_still_defaults_the_handle_on_a_plain_node():
    graph = {"nodes": [{"id": "llm", "data": {"type": "llm"}}, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "llm", "a")

    assert new_graph["edges"][0]["sourceHandle"] == "source"


# ---- apply_connect: declared_branch_handles acceptances (Task 4) -----------
# fail-branch nodes declare "source" (their real success handle, not an
# invented "success") + "fail-branch"; human-input declares its action ids +
# the implicit "__timeout" arm. apply_connect must accept a connect on any of
# these, not just if-else's case ids.

_FAIL_BRANCH_HTTP = {"id": "http1", "data": {"type": "http-request", "error_strategy": "fail-branch"}}
_HUMAN_INPUT = {
    "id": "human1",
    "data": {"type": "human-input", "user_actions": [{"id": "approve"}, {"id": "reject"}]},
}


def test_apply_connect_accepts_the_source_handle_on_a_fail_branch_node():
    graph = {"nodes": [_FAIL_BRANCH_HTTP, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "http1", "a", source_handle="source")

    assert new_graph["edges"][0]["sourceHandle"] == "source"


def test_apply_connect_accepts_the_default_handle_on_a_fail_branch_node():
    graph = {"nodes": [_FAIL_BRANCH_HTTP, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "http1", "a")

    assert new_graph["edges"][0]["sourceHandle"] == "source"


def test_apply_connect_accepts_the_fail_branch_handle_on_a_fail_branch_node():
    graph = {"nodes": [_FAIL_BRANCH_HTTP, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "http1", "a", source_handle="fail-branch")

    assert new_graph["edges"][0]["sourceHandle"] == "fail-branch"


def test_apply_connect_accepts_the_timeout_handle_on_a_human_input_node():
    graph = {"nodes": [_HUMAN_INPUT, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "human1", "a", source_handle="__timeout")

    assert new_graph["edges"][0]["sourceHandle"] == "__timeout"


def test_apply_connect_accepts_true_on_a_legacy_if_else_without_cases():
    # A pre-``cases`` if-else (top-level ``conditions``) routes its IF arm on
    # "true" (graphon IfElseNodeData.iter_cases); it must not be refused.
    legacy = {
        "id": "legacy",
        "data": {"type": "if-else", "logical_operator": "and", "conditions": []},
    }
    graph = {"nodes": [legacy, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "legacy", "a", source_handle="true")

    assert new_graph["edges"][0]["sourceHandle"] == "true"


def test_apply_connect_still_accepts_any_handle_on_a_plain_node_type():
    plain = {"id": "llm1", "data": {"type": "llm"}}
    graph = {"nodes": [plain, _TARGET], "edges": []}

    new_graph, _ = apply_connect(graph, "llm1", "a", source_handle="whatever")

    assert new_graph["edges"][0]["sourceHandle"] == "whatever"


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


def test_filter_rejects_duplicate_node_id():
    intents = [MutationIntent(op="create_node", args={"node_type": "llm", "config": {}, "node_id": "a"})]
    ok, bad = graph_ops.filter_applicable(_G, intents, allowed_node_types={"llm", "end"})
    assert ok == []
    assert "already exists" in bad[0][1]


def test_filter_rejects_insert_between_with_non_dict_edge():
    # A hallucinated insert_between with a string edge (not a {source,target} dict)
    # must be REJECTED gracefully, never raise (it would crash the advance).
    intents = [MutationIntent(op="insert_between", args={"edge": "a-b", "node_type": "llm", "config": {}})]
    ok, bad = graph_ops.filter_applicable(_G, intents, allowed_node_types={"llm", "end"})
    assert ok == []
    assert len(bad) == 1  # rejected with a reason, not raised


def _ifelse_graph():
    return {
        "nodes": [
            {
                "id": "node5",
                "data": {
                    "type": "if-else",
                    "title": "Review Decision",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {"variable_selector": ["node4", "score"], "comparison_operator": ">", "value": "0"},
                                {"variable_selector": ["node4", "text"], "comparison_operator": ">", "value": "5"},
                            ],
                        }
                    ],
                },
            }
        ],
        "edges": [],
    }


def test_set_node_config_writes_through_a_dotted_path():
    graph = _ifelse_graph()
    out, changed = apply_set_node_config(graph, "node5", "cases.0.conditions.1.comparison_operator", "contains")
    assert changed == ["node5"]
    condition = out["nodes"][0]["data"]["cases"][0]["conditions"][1]
    assert condition["comparison_operator"] == "contains"
    # the sibling condition is untouched
    assert out["nodes"][0]["data"]["cases"][0]["conditions"][0]["comparison_operator"] == ">"
    # and no junk flat key was created
    assert "cases.0.conditions.1.comparison_operator" not in out["nodes"][0]["data"]


def test_set_node_config_still_writes_a_top_level_key():
    graph = {"nodes": [{"id": "n1", "data": {"type": "code"}}], "edges": []}
    out, changed = apply_set_node_config(graph, "n1", "code", "print(1)")
    assert changed == ["n1"]
    assert out["nodes"][0]["data"]["code"] == "print(1)"


def test_set_node_config_creates_a_missing_top_level_key():
    """Unchanged behaviour: the LAST segment may be new -- that is the write."""
    graph = {"nodes": [{"id": "n1", "data": {"type": "code"}}], "edges": []}
    out, _changed = apply_set_node_config(graph, "n1", "outputs", {"result": {"type": "string"}})
    assert out["nodes"][0]["data"]["outputs"] == {"result": {"type": "string"}}


def test_set_node_config_rejects_a_missing_intermediate_key():
    graph = {"nodes": [{"id": "n1", "data": {"type": "code"}}], "edges": []}
    with pytest.raises(ValueError, match="no key 'cases'"):
        apply_set_node_config(graph, "n1", "cases.0.value", "x")


def test_set_node_config_rejects_an_out_of_range_index():
    graph = _ifelse_graph()
    with pytest.raises(ValueError, match="out of range"):
        apply_set_node_config(graph, "node5", "cases.0.conditions.7.value", "x")


def test_set_node_config_rejects_an_index_into_a_mapping():
    graph = _ifelse_graph()
    with pytest.raises(ValueError, match="not a list"):
        apply_set_node_config(graph, "node5", "cases.0.0", "x")


def test_set_node_config_rejects_an_empty_segment():
    graph = _ifelse_graph()
    with pytest.raises(ValueError, match="empty segment"):
        apply_set_node_config(graph, "node5", "cases..0", "x")


def test_filter_applicable_rejects_a_bad_path_with_a_reason():
    """The whole point of raising: the repair agent gets corrective feedback."""
    from services.dify_builder.graph_ops import filter_applicable

    graph = _ifelse_graph()
    intent = MutationIntent(
        op="set_node_config",
        args={"node_id": "node5", "path": "cases.0.conditions.9.value", "value": "x"},
    )
    applicable, rejected = filter_applicable(graph, [intent])
    assert applicable == []
    assert len(rejected) == 1
    assert "out of range" in rejected[0][1]


@pytest.mark.parametrize(
    ("op", "args"),
    [
        ("set_node_config", {"node_id": 5, "path": "code", "value": "x"}),
        ("delete_node", {"node_id": ""}),
        ("connect", {"from_node": "n1", "to_node": 2}),
        ("connect", {"from_node": None, "to_node": "n2"}),
    ],
)
def test_validate_intent_args_rejects_a_non_string_node_id(op, args):
    with pytest.raises(ValueError, match="must be a non-empty string"):
        validate_intent_args(MutationIntent(op=op, args=args))


def test_validate_intent_args_still_accepts_string_node_ids():
    validate_intent_args(MutationIntent(op="connect", args={"from_node": "n1", "to_node": "n2"}))
    validate_intent_args(MutationIntent(op="delete_node", args={"node_id": "n1"}))


@pytest.mark.parametrize("bad_path", [5, "", None, ["cases", 0]])
def test_validate_intent_args_rejects_a_non_string_path(bad_path):
    with pytest.raises(ValueError, match="must be a non-empty string"):
        validate_intent_args(
            MutationIntent(op="set_node_config", args={"node_id": "n1", "path": bad_path, "value": "x"})
        )
