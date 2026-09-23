import json

from core.dify_builder.models import MutationIntent
from services.dify_builder import credentials, graph_ops
from services.dify_builder.agent import edit


class _Msg:
    def __init__(self, text):
        self._t = text

    def get_text_content(self):
        return self._t


class _Result:
    def __init__(self, text):
        self.message = _Msg(text)


class _FakeInstance:
    def __init__(self, replies):
        self._replies = list(replies)

    def invoke_llm(self, **_kwargs):
        return _Result(self._replies.pop(0))


class _BoomInstance:
    def invoke_llm(self, **_kwargs):
        raise RuntimeError("provider down")


class _RecordingInstance:
    """Like ``_FakeInstance`` but keeps every ``invoke_llm`` call's kwargs, so a
    test can assert how many round-trips happened (e.g. "exactly one retry")."""

    def __init__(self, replies):
        self._replies = list(replies)
        self.calls: list[dict] = []

    def invoke_llm(self, **kwargs):
        self.calls.append(kwargs)
        return _Result(self._replies.pop(0))


_GRAPH = {"nodes": [{"id": "llm", "data": {"type": "llm", "title": "LLM"}}], "edges": []}

# A branch node (if-else) plus a plain node to connect to it, for the
# source_handle retry tests: connecting "branch" -> "a" with no source_handle
# defaults to "source", which apply_connect now rejects (branch declares only
# "true"/"false").
_BRANCH_GRAPH = {
    "nodes": [
        {"id": "llm", "data": {"type": "llm", "title": "LLM"}},
        {"id": "branch", "data": {"type": "if-else", "cases": [{"case_id": "true", "conditions": []}]}},
        {"id": "a", "data": {"type": "llm"}},
    ],
    "edges": [],
}


def test_analyze_impact_returns_fields_values_targets():
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "tone", "label": "Tone", "type": "text"}],
                    "values": {"tone": "formal"},
                    "target_node_ids": ["llm", "ghost"],
                }
            )
        ]
    )
    out = edit.analyze_impact(m, "make formal", _GRAPH)
    assert out["values"] == {"tone": "formal"}
    assert out["target_node_ids"] == ["llm"]  # unknown id dropped


def test_analyze_impact_reconciles_boolean_value_with_field_type():
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "confirm_clear", "label": "Confirm clear", "type": "text"}],
                    "values": {"confirm_clear": True},
                    "target_node_ids": ["llm"],
                }
            )
        ]
    )

    out = edit.analyze_impact(m, "clear the canvas", _GRAPH)

    assert out["fields"][0]["type"] == "bool"
    assert out["values"]["confirm_clear"] is True


def test_analyze_impact_none_model_degrades():
    out = edit.analyze_impact(None, "make formal", _GRAPH)
    assert out["fields"]
    assert out["values"] == {"change": "make formal"}
    assert out["target_node_ids"] == []


def test_analyze_impact_provider_error_degrades():
    out = edit.analyze_impact(_BoomInstance(), "make formal", _GRAPH)
    assert out["fields"]
    assert out["values"] == {"change": "make formal"}
    assert out["target_node_ids"] == []


def test_analyze_impact_non_list_target_node_ids_degrades_without_raising():
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "tone", "label": "Tone", "type": "text"}],
                    "values": {"tone": "formal"},
                    "target_node_ids": 5,
                }
            )
        ]
    )
    out = edit.analyze_impact(m, "make formal", _GRAPH)
    assert out["target_node_ids"] == []


def test_propose_edit_plan_bullets():
    m = _FakeInstance([json.dumps({"plan": ["Tighten prompt"]})])
    assert edit.propose_edit_plan(m, {"tone": "formal"}, _GRAPH) == ["Tighten prompt"]


def test_propose_edit_plan_none_model_degrades():
    assert edit.propose_edit_plan(None, {"tone": "formal"}, _GRAPH) == ["Apply the requested edit"]


def test_propose_edit_plan_provider_error_degrades():
    out = edit.propose_edit_plan(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out == ["Apply the requested edit"]


def test_propose_edit_plan_non_list_plan_degrades():
    m = _FakeInstance([json.dumps({"plan": "not-a-list"})])
    out = edit.propose_edit_plan(m, {"tone": "formal"}, _GRAPH)
    assert out == ["Apply the requested edit"]


def test_build_edit_intents_validates_and_drops_bad():
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "intents": [
                        {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Formal LLM"}},
                        {"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}},
                    ]
                }
            )
        ]
    )
    out = edit.build_edit_intents(m, {"tone": "formal"}, _GRAPH)
    assert [i.args["node_id"] for i in out] == ["llm"]  # bad node dropped by filter_applicable


def test_build_edit_intents_degrades_to_empty_on_none():
    assert edit.build_edit_intents(None, {}, _GRAPH) == []


def test_build_edit_intents_provider_error_degrades_to_empty():
    out = edit.build_edit_intents(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out == []


def test_build_edit_intents_total_reject_reprompts_then_recovers():
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    good = json.dumps(
        {"intents": [{"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Formal LLM"}}]}
    )
    out = edit.build_edit_intents(_FakeInstance([bad, good]), {"tone": "formal"}, _GRAPH)
    assert [i.args["node_id"] for i in out] == ["llm"]


def test_build_edit_intents_total_reject_twice_returns_empty():
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    out = edit.build_edit_intents(_FakeInstance([bad, bad]), {"tone": "formal"}, _GRAPH)
    assert out == []


def test_build_edit_intents_non_list_intents_degrades_to_empty():
    m = _FakeInstance([json.dumps({"intents": "oops"})])
    out = edit.build_edit_intents(m, {"tone": "formal"}, _GRAPH)
    assert out == []


# ---- source_handle: branch-handle grounding + partial-reject retry (review round 1) ----


def test_op_schema_mentions_source_handle_for_branch_connects():
    assert "source_handle" in edit._OP_SCHEMA
    assert "if-else" in edit._OP_SCHEMA


def test_graph_context_lists_branch_handles_and_a_named_edge_handle():
    graph = {
        "nodes": [
            {"id": "branch", "data": {"type": "if-else", "cases": [{"case_id": "true", "conditions": []}]}},
            {"id": "a", "data": {"type": "llm"}},
        ],
        "edges": [{"source": "branch", "target": "a", "sourceHandle": "true"}],
    }

    context = edit._graph_context(graph)

    assert "handles=['true', 'false']" in context
    assert "branch -[true]-> a" in context


def test_graph_context_plain_edge_has_no_handle_suffix():
    graph = {
        "nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "llm"}}],
        "edges": [{"source": "a", "target": "b", "sourceHandle": "source"}],
    }

    context = edit._graph_context(graph)

    assert "a -> b" in context
    assert "-[" not in context


def test_build_edit_intents_partial_reject_retries_once_then_recovers_both():
    first = json.dumps(
        {
            "intents": [
                {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Renamed"}},
                {"op": "connect", "args": {"from_node": "branch", "to_node": "a"}},  # no source_handle -> rejected
            ]
        }
    )
    retry = json.dumps(
        {
            "intents": [
                {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Renamed"}},
                {"op": "connect", "args": {"from_node": "branch", "to_node": "a", "source_handle": "true"}},
            ]
        }
    )
    m = _RecordingInstance([first, retry])

    out = edit.build_edit_intents(m, {"tone": "formal"}, _BRANCH_GRAPH)

    assert len(m.calls) == 2  # exactly one retry
    kinds = {(i.op, i.args.get("node_id") or i.args.get("from_node")) for i in out}
    assert kinds == {("set_node_config", "llm"), ("connect", "branch")}


def test_build_edit_intents_partial_reject_keeps_first_attempt_when_retry_still_fails():
    first = json.dumps(
        {
            "intents": [
                {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Renamed"}},
                {"op": "connect", "args": {"from_node": "branch", "to_node": "a"}},
            ]
        }
    )
    retry_still_bad = json.dumps(
        {"intents": [{"op": "connect", "args": {"from_node": "branch", "to_node": "a"}}]}  # still no source_handle
    )
    m = _RecordingInstance([first, retry_still_bad])

    out = edit.build_edit_intents(m, {"tone": "formal"}, _BRANCH_GRAPH)

    assert len(m.calls) == 2  # the one retry was spent, and still failed
    assert [i.args["node_id"] for i in out] == ["llm"]  # first attempt's valid intent kept, not dropped


# ---- node config grounding: the model must SEE what it is about to rewrite ----
#
# Triage edit-branch-failure-2026-09-22 cause (c): the Edit prompt showed only
# title/type/handles, so an LLM asked to add one if-else branch regenerated the
# whole ``cases`` array and silently turned ``= 60`` into ``>= 60``.

_IF_ELSE_CASES = [
    {
        "case_id": "true",
        "logical_operator": "and",
        "conditions": [
            {
                "id": "c1",
                "varType": "number",
                "variable_selector": ["start", "score"],
                "comparison_operator": "=",
                "value": "60",
            }
        ],
    }
]

_AGGREGATOR_VARIABLES = [["node3", "output"], ["node4", "output"]]

# start -> node2 (if-else) -> node3/node4 (template-transform) -> node5
# (variable-aggregator) -> end.
_TARGET_GRAPH = {
    "nodes": [
        {"id": "start", "data": {"type": "start", "title": "Start", "variables": [{"variable": "score"}]}},
        {"id": "node2", "data": {"type": "if-else", "title": "Check score", "cases": _IF_ELSE_CASES}},
        {"id": "node3", "data": {"type": "template-transform", "title": "Pass", "template": "pass", "variables": []}},
        {"id": "node4", "data": {"type": "template-transform", "title": "Fail", "template": "fail", "variables": []}},
        {
            "id": "node5",
            "data": {
                "type": "variable-aggregator",
                "title": "Merge",
                "output_type": "any",
                "variables": _AGGREGATOR_VARIABLES,
            },
        },
        {"id": "end", "data": {"type": "end", "title": "End", "outputs": [{"variable": "result"}]}},
    ],
    "edges": [
        {"source": "start", "target": "node2"},
        {"source": "node2", "target": "node3", "sourceHandle": "true"},
        {"source": "node2", "target": "node4", "sourceHandle": "false"},
        {"source": "node3", "target": "node5"},
        {"source": "node4", "target": "node5"},
        {"source": "node5", "target": "end"},
    ],
}


def test_graph_context_inlines_the_target_nodes_cases_verbatim():
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    assert json.dumps(_IF_ELSE_CASES, ensure_ascii=False) in context


def test_graph_context_reaches_the_aggregator_two_hops_past_a_branch_target():
    """The live S6 shape: the if-else ALONE is the target.

    node5 is two hops down (node2 -> node3/node4 -> node5). Its ``variables``
    is what says whether the new branch reaches the End node, so at one hop the
    model cannot extend it and the run succeeds with empty output -- triage
    cause (d).
    """
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    assert json.dumps(_AGGREGATOR_VARIABLES, ensure_ascii=False) in context


def test_graph_context_does_not_take_the_extra_hop_past_a_plain_target():
    # node3 is a template-transform, not a branch: its neighbours are in, but
    # nothing beyond them, so a long linear chain cannot drag in the whole graph.
    assert edit._detailed_ids(_TARGET_GRAPH, ["node3"]) == {"node2", "node3", "node5"}


def test_graph_context_leaves_a_non_target_non_neighbour_as_one_line():
    # ``end`` is three hops from the branch target -- past even the extra hop --
    # so it keeps today's summary line and nothing more.
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    lines = context.splitlines()
    end_line = next(i for i, line in enumerate(lines) if line.startswith("  end (end)"))
    assert "config:" not in lines[end_line + 1]
    assert '"result"' not in context


def test_graph_context_omits_keys_still_at_their_type_default():
    # ``output_type: "any"`` is node_defaults' value for a variable-aggregator,
    # so it is scaffolding; ``variables`` is the author's and stays.
    context = edit._graph_context(_TARGET_GRAPH, ["node5"])

    assert "output_type" not in context
    assert json.dumps(_AGGREGATOR_VARIABLES, ensure_ascii=False) in context


def test_graph_context_omits_the_two_dozen_default_keys_of_an_http_node():
    graph = {
        "nodes": [
            {
                "id": "http",
                "data": {
                    "type": "http-request",
                    "title": "Call",
                    "method": "get",
                    "url": "https://example.test/score",
                    "authorization": {"type": "no-auth", "config": None},
                    "headers": "",
                    "params": "",
                    "ssl_verify": True,
                    "retry_config": {"retry_enabled": True, "max_retries": 3, "retry_interval": 100},
                },
            }
        ],
        "edges": [],
    }

    context = edit._graph_context(graph, ["http"])

    assert "https://example.test/score" in context
    for scaffolding in ("authorization", "retry_config", "ssl_verify", "headers"):
        assert scaffolding not in context


def test_graph_context_marks_an_oversized_node_config_as_truncated():
    graph = {
        "nodes": [{"id": "big", "data": {"type": "template-transform", "title": "Big", "template": "x" * 4000}}],
        "edges": [],
    }

    context = edit._graph_context(graph, ["big"])

    assert edit._TRUNCATION_MARKER in context
    assert len(context) < 4000


def test_graph_context_without_targets_keeps_todays_one_line_form():
    context = edit._graph_context(_TARGET_GRAPH)

    assert "config:" not in context
    assert "  node2 (if-else): Check score handles=['true', 'false']" in context


def test_build_edit_intents_puts_the_target_config_in_the_prompt():
    m = _RecordingInstance([json.dumps({"intents": []})])

    edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    user = m.calls[0]["prompt_messages"][1].content
    assert json.dumps(_IF_ELSE_CASES, ensure_ascii=False) in user


def test_build_edit_intents_with_no_targets_falls_back_to_the_plain_context():
    m = _RecordingInstance([json.dumps({"intents": []})])

    out = edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH)

    assert out == []
    assert "config:" not in m.calls[0]["prompt_messages"][1].content


def test_build_edit_intents_accepts_but_does_not_yet_use_last_edit_rejection():
    # Declared now so the task that wires a refused write back into the prompt
    # does not have to change this function's arity a second time.
    m = _RecordingInstance([json.dumps({"intents": []})])

    edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH, last_edit_rejection="draft would not start")

    assert "draft would not start" not in m.calls[0]["prompt_messages"][1].content


# ---- credentials: withheld from the prompt, and un-writable back into the draft ----

_SECRET_HTTP_GRAPH = {
    "nodes": [
        {
            "id": "http",
            "data": {
                "type": "http-request",
                "title": "Call scoring API",
                "method": "post",
                "url": "https://example.test/score",
                "authorization": {
                    "type": "api-key",
                    "config": {"type": "bearer", "header": "X-Auth", "api_key": "sk-live-9f3c-SECRET"},
                },
                "headers": "Content-Type: application/json\nAuthorization: Bearer tok-999-SECRET",
                "params": "api_key: qp-777-SECRET",
            },
        }
    ],
    "edges": [],
}


def test_graph_context_withholds_an_api_key_behind_the_sentinel():
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "sk-live-9f3c-SECRET" not in context
    assert credentials.REDACTED in context
    # the STRUCTURE stays: the model must still know the auth mode and header name.
    assert '"bearer"' in context
    assert '"X-Auth"' in context


def test_graph_context_withholds_header_and_param_values_but_keeps_their_names():
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "tok-999-SECRET" not in context
    assert "qp-777-SECRET" not in context
    assert "Authorization:" in context  # the name survives
    assert "api_key:" in context
    assert "application/json" not in context  # every non-empty value goes, not just the obvious ones


def test_graph_context_legend_warns_the_model_off_writing_the_sentinel_back():
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "never write" in context


def test_redaction_does_not_mutate_the_live_graph():
    edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    data = _SECRET_HTTP_GRAPH["nodes"][0]["data"]
    assert data["authorization"]["config"]["api_key"] == "sk-live-9f3c-SECRET"
    assert "tok-999-SECRET" in data["headers"]


def test_a_write_carrying_the_sentinel_leaves_the_stored_credential_intact():
    """The other half of the guard.

    Redaction alone is worse than the leak: the model reads the placeholder,
    rewrites ``headers`` around it and destroys a working credential.
    """
    intent = MutationIntent(
        op="set_node_config",
        args={
            "node_id": "http",
            "path": "headers",
            "value": f"Content-Type: text/plain\nAuthorization: Bearer {credentials.REDACTED}",
        },
    )

    applicable, rejected = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert applicable == []
    assert len(rejected) == 1
    assert credentials.REDACTED in rejected[0][1]
    # and the stored value never moved
    assert "tok-999-SECRET" in _SECRET_HTTP_GRAPH["nodes"][0]["data"]["headers"]


def test_a_nested_sentinel_in_a_create_node_config_is_refused_too():
    intent = MutationIntent(
        op="create_node",
        args={
            "node_type": "http-request",
            "config": {"url": "https://example.test", "authorization": {"config": {"api_key": credentials.REDACTED}}},
        },
    )

    _applicable, rejected = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert len(rejected) == 1


def test_a_real_value_for_the_same_field_is_still_writable():
    intent = MutationIntent(
        op="set_node_config",
        args={"node_id": "http", "path": "headers", "value": "Authorization: Bearer tok-new"},
    )

    applicable, rejected = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert rejected == []
    assert applicable == [intent]


# ---- rendering minors ----


def test_graph_context_skips_a_config_line_that_would_only_repeat_the_summary():
    graph = {"nodes": [{"id": "a", "data": {"type": "llm", "title": "Only a title"}}], "edges": []}

    context = edit._graph_context(graph, ["a"])

    assert "config:" not in context
    assert "(config =" not in context  # and the legend is gated on a block actually rendering


def test_truncation_names_the_keys_it_dropped():
    graph = {
        "nodes": [
            {
                "id": "big",
                "data": {"type": "template-transform", "title": "Big", "template": "x" * 4000, "variables": ["v"]},
            }
        ],
        "edges": [],
    }

    context = edit._graph_context(graph, ["big"])

    assert edit._TRUNCATION_MARKER in context
    assert "template" in context.split(edit._TRUNCATION_MARKER)[1]
    assert "x" * 4000 not in context
    assert len(context) < 4000
