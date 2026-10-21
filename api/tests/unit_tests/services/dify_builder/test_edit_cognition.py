import copy
import json
from typing import Never, get_args
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from typing_extensions import TypedDict

from core.dify_builder.errors import ProposalWouldRunWrongError
from core.dify_builder.models import Graph, MutationIntent
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.utils.condition.entities import Condition, SupportedComparisonOperator
from services.dify_builder import credentials, graph_ops
from services.dify_builder.agent import edit, graph_prompt
from services.dify_builder.preflight import new_preflight_problems, preflight_errors


def _message_text(message: PromptMessage) -> str:
    assert isinstance(message.content, str)
    return message.content


class _Msg:
    def __init__(self, text: str) -> None:
        self._t = text

    def get_text_content(self) -> str:
        return self._t


class _Result:
    def __init__(self, text: str) -> None:
        self.message = _Msg(text)


class _FakeInstance(MagicMock):
    def __init__(self, replies: list[str]) -> None:
        super().__init__()
        self._replies = list(replies)

    def invoke_llm(self, **_kwargs: object) -> _Result:
        return _Result(self._replies.pop(0))


class _BoomInstance(MagicMock):
    def invoke_llm(self, **_kwargs: object) -> Never:
        raise RuntimeError("provider down")


class RecordedInvocation(TypedDict):
    prompt_messages: list[PromptMessage]


class _RecordingInstance(MagicMock):
    """Like ``_FakeInstance`` but keeps every ``invoke_llm`` call's kwargs, so a
    test can assert how many round-trips happened (e.g. "exactly one retry")."""

    def __init__(self, replies: list[str]) -> None:
        super().__init__()
        self._replies = list(replies)
        self.calls: list[RecordedInvocation] = []

    def invoke_llm(self, *, prompt_messages: list[PromptMessage], **kwargs: object) -> _Result:
        del kwargs
        self.calls.append({"prompt_messages": prompt_messages})
        return _Result(self._replies.pop(0))


_GRAPH: Graph = {"nodes": [{"id": "llm", "data": {"type": "llm", "title": "LLM"}}], "edges": []}

# A branch node (if-else) plus a plain node to connect to it, for the
# source_handle retry tests: connecting "branch" -> "a" with no source_handle
# defaults to "source", which apply_connect now rejects (branch declares only
# "true"/"false").
_BRANCH_GRAPH: Graph = {
    "nodes": [
        {"id": "llm", "data": {"type": "llm", "title": "LLM"}},
        {"id": "branch", "data": {"type": "if-else", "cases": [{"case_id": "true", "conditions": []}]}},
        {"id": "a", "data": {"type": "llm"}},
    ],
    "edges": [],
}


def test_analyze_impact_returns_fields_values_targets() -> None:
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


def test_analyze_impact_reconciles_boolean_value_with_field_type() -> None:
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


def test_analyze_impact_none_model_degrades() -> None:
    out = edit.analyze_impact(None, "make formal", _GRAPH)
    assert out["fields"]
    assert out["values"] == {"change": "make formal"}
    assert out["target_node_ids"] == []


def test_analyze_impact_provider_error_degrades() -> None:
    out = edit.analyze_impact(_BoomInstance(), "make formal", _GRAPH)
    assert out["fields"]
    assert out["values"] == {"change": "make formal"}
    assert out["target_node_ids"] == []


def test_analyze_impact_non_list_target_node_ids_degrades_without_raising() -> None:
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


def test_propose_edit_plan_bullets() -> None:
    m = _FakeInstance(
        [
            json.dumps(
                {
                    "title": "Make support replies formal",
                    "input_summary": "A support question.",
                    "output_summary": "A formal reply to the question.",
                    "plan": ["Tighten prompt"],
                }
            )
        ]
    )
    out = edit.propose_edit_plan(m, {"tone": "formal"}, _GRAPH)
    assert out is not None
    assert out.items == ["Tighten prompt"]
    assert out.title == "Make support replies formal"
    assert out.input_summary == "A support question."
    assert out.output_summary == "A formal reply to the question."


def test_propose_edit_plan_none_model_returns_no_approvable_plan() -> None:
    assert edit.propose_edit_plan(None, {"tone": "formal"}, _GRAPH) is None


def test_propose_edit_plan_provider_error_returns_no_approvable_plan() -> None:
    out = edit.propose_edit_plan(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out is None


def test_propose_edit_plan_non_list_plan_returns_no_approvable_plan() -> None:
    m = _FakeInstance([json.dumps({"plan": "not-a-list"})] * 2)
    out = edit.propose_edit_plan(m, {"tone": "formal"}, _GRAPH)
    assert out is None


def test_edit_plan_sees_existing_workflow_inputs_and_outputs() -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [{"variable": "question", "label": "Support question", "type": "text-input"}],
                },
            },
            {"id": "llm", "data": {"type": "llm", "title": "Answer the question"}},
            {
                "id": "end",
                "data": {"type": "end", "outputs": [{"variable": "answer", "value_selector": ["llm", "text"]}]},
            },
        ],
        "edges": [{"source": "start", "target": "llm"}, {"source": "llm", "target": "end"}],
    }
    model = _RecordingInstance(
        [
            json.dumps(
                {
                    "title": "Make support replies formal",
                    "input_summary": "A support question.",
                    "output_summary": "A formal answer to the support question.",
                    "plan": ["Use a formal tone in the answer"],
                }
            )
        ]
    )

    plan = edit.propose_edit_plan(model, {"tone": "formal"}, graph)

    assert plan is not None
    assert plan.input_summary == "A support question."
    assert plan.output_summary == "A formal answer to the support question."
    assert len(model.calls) == 1
    system, user = model.calls[0]["prompt_messages"]
    assert "entire resulting workflow" in _message_text(system)
    assert "remain unchanged" in _message_text(system)
    assert "Support question" in _message_text(user)
    assert '"value_selector": ["llm", "text"]' in _message_text(user)


def test_build_edit_intents_validates_and_drops_bad() -> None:
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


def test_build_edit_intents_degrades_to_empty_on_none() -> None:
    assert edit.build_edit_intents(None, {}, _GRAPH) == []


def test_build_edit_intents_provider_error_degrades_to_empty() -> None:
    out = edit.build_edit_intents(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out == []


def test_build_edit_intents_total_reject_reprompts_then_recovers() -> None:
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    good = json.dumps(
        {"intents": [{"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Formal LLM"}}]}
    )
    out = edit.build_edit_intents(_FakeInstance([bad, good]), {"tone": "formal"}, _GRAPH)
    assert [i.args["node_id"] for i in out] == ["llm"]


def test_build_edit_intents_total_reject_twice_returns_empty() -> None:
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    out = edit.build_edit_intents(_FakeInstance([bad, bad]), {"tone": "formal"}, _GRAPH)
    assert out == []


def test_build_edit_intents_non_list_intents_degrades_to_empty() -> None:
    m = _FakeInstance([json.dumps({"intents": "oops"})])
    out = edit.build_edit_intents(m, {"tone": "formal"}, _GRAPH)
    assert out == []


# ---- source_handle: branch-handle grounding + partial-reject retry (review round 1) ----


def test_op_schema_mentions_source_handle_for_branch_connects() -> None:
    assert "source_handle" in edit._OP_SCHEMA
    assert "if-else" in edit._OP_SCHEMA


def test_graph_context_lists_branch_handles_and_a_named_edge_handle() -> None:
    graph: Graph = {
        "nodes": [
            {"id": "branch", "data": {"type": "if-else", "cases": [{"case_id": "true", "conditions": []}]}},
            {"id": "a", "data": {"type": "llm"}},
        ],
        "edges": [{"source": "branch", "target": "a", "sourceHandle": "true"}],
    }

    context = edit._graph_context(graph)

    assert "handles=['true', 'false']" in context
    assert "branch -[true]-> a" in context


def test_graph_context_plain_edge_has_no_handle_suffix() -> None:
    graph: Graph = {
        "nodes": [{"id": "a", "data": {"type": "llm"}}, {"id": "b", "data": {"type": "llm"}}],
        "edges": [{"source": "a", "target": "b", "sourceHandle": "source"}],
    }

    context = edit._graph_context(graph)

    assert "a -> b" in context
    assert "-[" not in context


def test_build_edit_intents_partial_reject_retries_once_then_recovers_both() -> None:
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


def test_build_edit_intents_partial_reject_keeps_first_attempt_when_retry_still_fails() -> None:
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
_TARGET_GRAPH: Graph = {
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


def test_graph_context_inlines_the_target_nodes_cases_verbatim() -> None:
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    assert json.dumps(_IF_ELSE_CASES, ensure_ascii=False) in context


def test_graph_context_reaches_the_aggregator_two_hops_past_a_branch_target() -> None:
    """The live S6 shape: the if-else ALONE is the target.

    node5 is two hops down (node2 -> node3/node4 -> node5). Its ``variables``
    is what says whether the new branch reaches the End node, so at one hop the
    model cannot extend it and the run succeeds with empty output -- triage
    cause (d).
    """
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    assert json.dumps(_AGGREGATOR_VARIABLES, ensure_ascii=False) in context


def test_graph_context_does_not_take_the_extra_hop_past_a_plain_target() -> None:
    # node3 is a template-transform, not a branch: its neighbours are in, but
    # nothing beyond them, so a long linear chain cannot drag in the whole graph.
    assert edit._detailed_ids(_TARGET_GRAPH, ["node3"]) == {"node2", "node3", "node5"}


def test_graph_context_leaves_a_non_target_non_neighbour_as_one_line() -> None:
    # ``end`` is three hops from the branch target -- past even the extra hop --
    # so it keeps today's summary line and nothing more.
    context = edit._graph_context(_TARGET_GRAPH, ["node2"])

    lines = context.splitlines()
    end_line = next(i for i, line in enumerate(lines) if line.startswith("  end (end)"))
    assert "config:" not in lines[end_line + 1]
    assert '"result"' not in context


def test_graph_context_omits_keys_still_at_their_type_default() -> None:
    # ``output_type: "any"`` is node_defaults' value for a variable-aggregator,
    # so it is scaffolding; ``variables`` is the author's and stays.
    context = edit._graph_context(_TARGET_GRAPH, ["node5"])

    assert "output_type" not in context
    assert json.dumps(_AGGREGATOR_VARIABLES, ensure_ascii=False) in context


def test_graph_context_omits_the_two_dozen_default_keys_of_an_http_node() -> None:
    graph: Graph = {
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


def test_graph_context_marks_an_oversized_node_config_as_truncated() -> None:
    graph: Graph = {
        "nodes": [{"id": "big", "data": {"type": "template-transform", "title": "Big", "template": "x" * 4000}}],
        "edges": [],
    }

    context = edit._graph_context(graph, ["big"])

    assert graph_prompt.TRUNCATION_MARKER in context
    assert len(context) < 4000


def test_graph_context_without_targets_keeps_todays_one_line_form() -> None:
    context = edit._graph_context(_TARGET_GRAPH)

    assert "config:" not in context
    assert "  node2 (if-else): Check score handles=['true', 'false']" in context


def test_build_edit_intents_puts_the_target_config_in_the_prompt() -> None:
    m = _RecordingInstance([json.dumps({"intents": []})])

    edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    user = _message_text(m.calls[0]["prompt_messages"][1])
    assert json.dumps(_IF_ELSE_CASES, ensure_ascii=False) in user


def test_build_edit_intents_with_no_targets_falls_back_to_the_plain_context() -> None:
    m = _RecordingInstance([json.dumps({"intents": []})])

    out = edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH)

    assert out == []
    assert "config:" not in _message_text(m.calls[0]["prompt_messages"][1])


# ---- what the engine said last time reaches the next attempt ----------------
#
# Triage edit-branch-failure-2026-09-22, "Why every retry is blind": the gate
# re-reads an UNCHANGED draft on every re-approval, so ``edit_rules`` and
# ``graph`` are byte-identical each time. The engine's refusal of the previous
# write is the only input that can make the second attempt differ from the first.


def _with_operator(operator: str) -> Graph:
    """``_TARGET_GRAPH`` with node2's one condition using ``operator``."""
    graph = copy.deepcopy(_TARGET_GRAPH)
    graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["comparison_operator"] = operator
    return graph


def test_build_edit_intents_quotes_the_engines_refusal_of_the_previous_attempt() -> None:
    m = _RecordingInstance([json.dumps({"intents": []})])
    rejection = "the draft would not start: node 'node2' (if-else): 1 validation error for IfElseNodeData"

    edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH, last_edit_rejection=rejection)

    user = _message_text(m.calls[0]["prompt_messages"][1])
    assert f"PREVIOUS ATTEMPT REJECTED BY THE ENGINE:\n{rejection}\nDo not repeat it." in user


def test_no_previous_refusal_leaves_the_prompt_exactly_as_it_was() -> None:
    m = _RecordingInstance([json.dumps({"intents": []})])

    edit.build_edit_intents(m, {"tone": "formal"}, _TARGET_GRAPH)

    assert "PREVIOUS ATTEMPT REJECTED" not in _message_text(m.calls[0]["prompt_messages"][1])


def test_the_engines_text_separates_two_refusals_the_preflight_key_cannot() -> None:
    """The hole the port-rejection feedback exists to cover.

    ``new_preflight_problems`` is keyed on pydantic error LOCATIONS, so a second
    attempt that leaves the culprit invalid at the SAME location with a
    DIFFERENT bad value is not a new problem to it -- the dry run has nothing
    left to say, and every retry after the first would be blind again. The
    engine's own message names the value it refused, so carrying it forward is
    the one thing that makes two such attempts distinguishable to the model.
    """
    klingon, martian = _with_operator("klingon"), _with_operator("martian")

    # what the location key sees: nothing new, so the dry run cannot re-prompt...
    assert new_preflight_problems(klingon, martian, ()) == []
    # ...while the engine's own words name the value each time.
    klingon_text = next(e for e in preflight_errors(klingon) if "'node2'" in e)
    martian_text = next(e for e in preflight_errors(martian) if "'node2'" in e)
    assert "input_value='klingon'" in klingon_text
    assert "input_value='martian'" in martian_text

    prompts = []
    for text in (klingon_text, martian_text):
        m = _RecordingInstance([json.dumps({"intents": []})])
        edit.build_edit_intents(
            m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"], last_edit_rejection=text
        )
        prompts.append(_message_text(m.calls[0]["prompt_messages"][1]))

    assert "input_value='klingon'" in prompts[0]
    assert "input_value='martian'" not in prompts[0]
    assert "input_value='martian'" in prompts[1]
    assert "input_value='klingon'" not in prompts[1]


def test_the_previous_refusal_stays_in_front_of_the_model_through_the_retry() -> None:
    """The corrective re-prompt is built on top of the same user turn, so a
    model that burns its one retry still has the engine's earlier refusal in
    view rather than only this attempt's."""
    m = _RecordingInstance([_operator_intents("=="), _operator_intents("≥")])

    edit.build_edit_intents(
        m,
        {"threshold": "90"},
        _TARGET_GRAPH,
        edit_target_node_ids=["node2"],
        last_edit_rejection="the draft would not start: node 'node2' (if-else): input_value='klingon'",
    )

    assert "input_value='klingon'" in _message_text(m.calls[1]["prompt_messages"][1])


# ---- credentials: withheld from the prompt, and un-writable back into the draft ----

_SECRET_HTTP_GRAPH: Graph = {
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


def test_graph_context_withholds_an_api_key_behind_the_sentinel() -> None:
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "sk-live-9f3c-SECRET" not in context
    assert credentials.REDACTED in context
    # the STRUCTURE stays: the model must still know the auth mode and header name.
    assert '"bearer"' in context
    assert '"X-Auth"' in context


def test_graph_context_withholds_header_and_param_values_but_keeps_their_names() -> None:
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "tok-999-SECRET" not in context
    assert "qp-777-SECRET" not in context
    assert "Authorization:" in context  # the name survives
    assert "api_key:" in context
    assert "application/json" not in context  # every non-empty value goes, not just the obvious ones


def test_graph_context_legend_warns_the_model_off_writing_the_sentinel_back() -> None:
    context = edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    assert "never write" in context


def test_redaction_does_not_mutate_the_live_graph() -> None:
    edit._graph_context(_SECRET_HTTP_GRAPH, ["http"])

    data = _SECRET_HTTP_GRAPH["nodes"][0]["data"]
    assert data["authorization"]["config"]["api_key"] == "sk-live-9f3c-SECRET"
    assert "tok-999-SECRET" in data["headers"]


def test_a_write_carrying_the_sentinel_leaves_the_stored_credential_intact() -> None:
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

    applicable, rejected, _dry, _changed = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert applicable == []
    assert len(rejected) == 1
    assert credentials.REDACTED in rejected[0][1]
    # and the stored value never moved
    assert "tok-999-SECRET" in _SECRET_HTTP_GRAPH["nodes"][0]["data"]["headers"]


def test_a_nested_sentinel_in_a_create_node_config_is_refused_too() -> None:
    intent = MutationIntent(
        op="create_node",
        args={
            "node_type": "http-request",
            "config": {"url": "https://example.test", "authorization": {"config": {"api_key": credentials.REDACTED}}},
        },
    )

    _applicable, rejected, _dry, _changed = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert len(rejected) == 1


def test_a_real_value_for_the_same_field_is_still_writable() -> None:
    intent = MutationIntent(
        op="set_node_config",
        args={"node_id": "http", "path": "headers", "value": "Authorization: Bearer tok-new"},
    )

    applicable, rejected, _dry, _changed = graph_ops.filter_applicable(_SECRET_HTTP_GRAPH, [intent])

    assert rejected == []
    assert applicable == [intent]


# ---- rendering minors ----


def test_graph_context_skips_a_config_line_that_would_only_repeat_the_summary() -> None:
    graph: Graph = {"nodes": [{"id": "a", "data": {"type": "llm", "title": "Only a title"}}], "edges": []}

    context = edit._graph_context(graph, ["a"])

    assert "config:" not in context
    assert "(config =" not in context  # and the legend is gated on a block actually rendering


def test_truncation_names_the_keys_it_dropped() -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "big",
                "data": {"type": "template-transform", "title": "Big", "template": "x" * 4000, "variables": ["v"]},
            }
        ],
        "edges": [],
    }

    context = edit._graph_context(graph, ["big"])

    assert graph_prompt.TRUNCATION_MARKER in context
    assert "template" in context.split(graph_prompt.TRUNCATION_MARKER)[1]
    assert "x" * 4000 not in context
    assert len(context) < 4000


# ---- what a correct array mutation looks like (triage causes (a), (c), (d)) ----


def _schema_operators(text: str) -> tuple[str, ...]:
    """The operator literals out of ``_COMPARISON_OPERATORS``'s prose, in order.

    Its shape is ``"<group>: a, b, c; <group>: d, e"``, so each ``;`` chunk's
    text after the ``:`` is a comma-separated list of literals. Parsing rather
    than substring-matching is what lets the drift guard run in BOTH directions.
    """
    out: list[str] = []
    for group in text.split(";"):
        _label, _, listed = group.partition(":")
        out.extend(item.strip() for item in listed.split(",") if item.strip())
    return tuple(out)


def test_op_schema_teaches_the_array_and_operator_rules_the_engine_enforces() -> None:
    """ONE test for four clauses, deliberately -- not four substring assertions.

    ``assert "<phrase>" in _OP_SCHEMA`` asserts nothing about behaviour: it pins
    a wording, so any reword fails it and any paraphrase passes it. The clauses
    that have real behaviour behind them are therefore checked against that
    behaviour -- ``_resolve_path`` for indexed-vs-appended paths, graphon's own
    ``Condition`` for the operator literals -- and only the two clauses that are
    pure instruction to the model (keep siblings byte-identical, extend the
    aggregator a new branch feeds) are checked as text. They live in one test
    because they are one contract: what the Edit agent is told a correct array
    mutation looks like.
    """
    schema = edit._OP_SCHEMA
    graph: Graph = {
        "nodes": [
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "title": "Score",
                    "cases": [
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
                    ],
                },
            }
        ],
        "edges": [],
    }

    # (a) indexed paths are real: one element changes and its siblings, including
    # the id/varType keys a whole-array rewrite would drop, survive untouched.
    changed, _ = graph_ops.apply_set_node_config(graph, "branch", "cases.0.conditions.0.comparison_operator", "≥")
    condition = changed["nodes"][0]["data"]["cases"][0]["conditions"][0]
    assert condition == {
        "id": "c1",
        "varType": "number",
        "variable_selector": ["start", "score"],
        "comparison_operator": "≥",
        "value": "60",
    }
    assert "cases.1.conditions.0.value" in schema

    # (b) an index past the end is NOT an append -- which is the whole reason the
    # schema tells the model to re-send the array to ADD, and only to ADD.
    cases = graph["nodes"][0]["data"]["cases"]
    with pytest.raises(ValueError, match="out of range"):
        graph_ops.apply_set_node_config(graph, "branch", "cases.1", {"case_id": "excellent"})
    grown, _ = graph_ops.apply_set_node_config(graph, "branch", "cases", [*cases, {"case_id": "excellent"}])
    assert [c["case_id"] for c in grown["nodes"][0]["data"]["cases"]] == ["true", "excellent"]

    # (c) the operator list the prompt advertises is EXACTLY graphon's Literal --
    # same members, same order. Compared as parsed tuples, not with `in schema`:
    # a substring check over 2.3kB of prose matches `=`, `is`, `in` anywhere and
    # can only ever catch an addition, never a removal or a misspelling.
    assert _schema_operators(graph_prompt.COMPARISON_OPERATORS) == get_args(SupportedComparisonOperator.__value__)
    assert graph_prompt.COMPARISON_OPERATORS in schema
    # ...and the ASCII forms the model reaches for are genuinely refused by the
    # engine. `>=`/`<=` are healed upstream by heal_nodes_for_preflight, so for
    # those the prompt is merely stricter than the port; the equality forms are
    # ambiguous, deliberately unhealed, and this prose is all that stops them.
    for ascii_form in (">=", "<=", "!="):
        with pytest.raises(ValidationError):
            Condition.model_validate(
                {"variable_selector": ["start", "score"], "comparison_operator": ascii_form, "value": "90"}
            )
    for engine_form in ("≥", "≤", "≠"):
        assert (
            Condition(
                variable_selector=["start", "score"], comparison_operator=engine_form, value="90"
            ).comparison_operator
            == engine_form
        )

    # (d) the pure-guidance clauses -- no code path enforces these, so text is
    # the only thing to assert: keep the untouched elements identical, and extend
    # the variable-aggregator the new branch feeds (cause (d), the one that ends
    # in "All checks passed" on empty output). The output-variable pairings are
    # pinned because a single hardcoded name would RECREATE cause (d): the
    # aggregator skips a selector it cannot resolve in silence, so ["llm", "output"]
    # -- an llm node publishes `text` -- runs green and produces nothing.
    #
    # Read off the shared mapping rather than a literal list, because
    # ``preflight``'s rejoin guard names the missing selector from that same
    # mapping: this is what stops the sentence the model reads and the sentence
    # the guard writes naming different variables.
    assert "byte-identical" in schema
    assert "variable-aggregator" in schema
    assert "variables" in schema
    assert graph_prompt.OUTPUT_VARIABLE_BY_NODE_TYPE  # a silent empty mapping would pass the loop below
    for node_type, variable in graph_prompt.OUTPUT_VARIABLE_BY_NODE_TYPE.items():
        assert f"{node_type}'s is {variable}" in schema

    # and never hand the redaction sentinel back (Task 3's withheld secrets).
    assert credentials.REDACTED in schema


# ---- the node-data half of the check: a proposal is engine-checked before the gate ----
#
# Triage edit-branch-failure-2026-09-22, "Why every retry is blind": the live
# Edit's four intents all passed the structural filter ("applicable, 0
# rejected"), the batch then died at ``apply_repair``'s preflight, and the one
# corrective re-prompt could never fire because nothing had been rejected -- so
# every re-approval re-sent a byte-identical prompt.
#
# ``==`` is the error these tests are built on because NO normalizer heals it and
# none may: graphon spells string equality ``is`` / ``is not`` and number
# equality ``=`` / ``≠``, so ``==`` is ambiguous between them (unlike ``>=``,
# which can only mean ``≥`` and IS healed before the preflight -- which is why it
# can no longer prove anything here).

_SET_EQ = '{"op": "set_node_config", "args": {"node_id": "node2", "path": "cases.0.conditions.0.%s", "value": "%s"}}'


def _operator_intents(operator: str) -> str:
    return '{"intents": [' + _SET_EQ % ("comparison_operator", operator) + "]}"


def test_build_edit_intents_reprompts_on_a_node_the_engine_would_refuse_and_recovers() -> None:
    m = _RecordingInstance([_operator_intents("=="), _operator_intents("≥")])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 2  # the batch was structurally applicable, and STILL burned the re-prompt
    assert [i.args["value"] for i in out] == ["≥"]


def test_the_corrective_reprompt_quotes_the_engines_own_words() -> None:
    m = _RecordingInstance([_operator_intents("=="), _operator_intents("≥")])

    edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    retry_prompt = _message_text(m.calls[1]["prompt_messages"][1])
    assert "Your previous intents were invalid:" in retry_prompt
    # the engine's literal message, node named and field named -- not model prose
    assert "the draft would then not start: node 'node2' (if-else): " in retry_prompt
    assert "cases.0.conditions.0.comparison_operator" in retry_prompt
    assert "Input should be" in retry_prompt


def test_a_batch_the_engine_accepts_never_spends_the_reprompt() -> None:
    m = _RecordingInstance([_operator_intents("≥")])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 1
    assert len(out) == 1


def test_the_drafts_pre_existing_problems_do_not_spend_the_reprompt() -> None:
    """``_TARGET_GRAPH``'s start and end nodes are already invalid -- the user's
    own half-finished draft. New problems only: the edit is unrelated to them and
    must go through in one call."""
    assert len(preflight_errors(_TARGET_GRAPH)) == 2  # the draft is already broken...
    m = _RecordingInstance(['{"intents": [' + _SET_EQ % ("value", "90") + "]}"])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 1  # ...and not one of those problems is this edit's fault
    assert [i.args["value"] for i in out] == ["90"]


def test_a_batch_refused_twice_still_goes_to_the_gate_where_the_write_refuses_it_loudly() -> None:
    """The budget is ONE corrective re-prompt. A model that writes the same
    unhealable operator twice has spent it: the batch is returned, ``apply_repair``
    refuses it by name, and the handler parks the session with the engine's reason
    rather than reporting an empty change set nobody can act on."""
    m = _RecordingInstance([_operator_intents("=="), _operator_intents("==")])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 2  # exactly one retry, never two
    assert [i.args["value"] for i in out] == ["=="]


def test_a_retry_that_returns_nothing_usable_falls_back_to_the_first_attempt() -> None:
    first = (
        '{"intents": ['
        + _SET_EQ % ("value", "90")
        + ", "
        + '{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}'
        + "]}"
    )
    m = _RecordingInstance([first, '{"intents": "oops"}'])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 2
    assert [i.args["node_id"] for i in out] == ["node2"]


# ---- a batch the agent has already judged wrong is never handed on to be written ----
#
# The two semantic guards (``preflight``'s rejoin and dropped-identity checks)
# describe defects the engine ACCEPTS: there is no ``DraftWouldNotStartError``
# behind them and ``apply_repair`` has nothing to veto. So the agent's own
# fallback is the last thing standing between a guard that fired and a silently
# wrong draft -- and returning "the first attempt's applicable intents" would
# have written exactly the batch the guard condemned.

_S6_BATCH = json.dumps(
    {
        "intents": [
            {
                "op": "create_node",
                "args": {
                    "node_type": "template-transform",
                    "node_id": "node7",
                    "config": {"title": "Excellent", "template": "excellent", "variables": []},
                },
            },
            {"op": "connect", "args": {"from_node": "node2", "to_node": "node7", "source_handle": "true"}},
            {"op": "connect", "args": {"from_node": "node7", "to_node": "node5"}},
        ]
    }
)

_S6_BATCH_REJOINED = json.dumps(
    {
        "intents": [
            {
                "op": "create_node",
                "args": {
                    "node_type": "template-transform",
                    "node_id": "node7",
                    "config": {"title": "Excellent", "template": "excellent", "variables": []},
                },
            },
            {"op": "connect", "args": {"from_node": "node2", "to_node": "node7", "source_handle": "true"}},
            {"op": "connect", "args": {"from_node": "node7", "to_node": "node5"}},
            {
                "op": "set_node_config",
                "args": {
                    "node_id": "node5",
                    "path": "variables",
                    "value": [["node3", "output"], ["node4", "output"], ["node7", "output"]],
                },
            },
        ]
    }
)


def test_a_model_that_ignores_the_guidance_twice_surfaces_instead_of_writing() -> None:
    """Both attempts wire a new arm into ``node5`` without extending its
    ``variables``. The old fallback returned the first attempt's applicable
    intents, so the guard fired and the known-bad batch was written anyway --
    landing back in the green-run-empty-output failure the guard exists to
    stop. Surfacing is safe now: the gate offers a revert and a keep-adjusting
    exit, and the reason is carried into the next attempt."""
    m = _RecordingInstance([_S6_BATCH, _S6_BATCH])

    with pytest.raises(ProposalWouldRunWrongError) as raised:
        edit.build_edit_intents(m, {"add": "an excellent branch"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 2  # the one retry was spent first
    assert "node5" in str(raised.value)
    assert "node7" in str(raised.value)


def test_a_model_that_takes_the_guidance_on_the_retry_is_written_as_normal() -> None:
    """The other half: the corrective re-prompt is what this is for, and a
    second attempt that extends the aggregator goes through untouched."""
    m = _RecordingInstance([_S6_BATCH, _S6_BATCH_REJOINED])

    out = edit.build_edit_intents(m, {"add": "an excellent branch"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) == 2
    assert len(out) == 4
    assert [i.op for i in out][-1] == "set_node_config"


def test_a_purely_structural_rejection_still_falls_back_to_the_first_attempt() -> None:
    """The distinction that keeps this from being a blanket "any rejection
    surfaces". A structural refusal DROPS the offending intent, so what is left
    is a batch nobody has judged wrong -- and Task 5 chose deliberately to keep
    it rather than lose the user's change. Only a whole-batch semantic verdict,
    which drops nothing and condemns what remains, blocks the fallback."""
    first = (
        '{"intents": ['
        + _SET_EQ % ("value", "90")
        + ", "
        + '{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}'
        + "]}"
    )
    m = _RecordingInstance([first, '{"intents": "oops"}'])

    out = edit.build_edit_intents(m, {"threshold": "90"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert [i.args["node_id"] for i in out] == ["node2"]


def test_a_first_attempt_the_guards_condemn_surfaces_even_when_the_retry_is_unusable() -> None:
    """The other route into the fallback: the retry comes back unparseable, so
    there is nothing to judge but the first attempt -- which the guards already
    condemned. It must not be written either."""
    m = _RecordingInstance([_S6_BATCH, "not json at all"])

    with pytest.raises(ProposalWouldRunWrongError):
        edit.build_edit_intents(m, {"add": "an excellent branch"}, _TARGET_GRAPH, edit_target_node_ids=["node2"])

    assert len(m.calls) >= 2  # the retry was spent before the refusal (invoke_json re-parses once of its own)


def test_edit_receives_stop_policy_and_preserves_known_error_strategy() -> None:
    """Editor guidance must not turn an unrelated Code edit into swallowed errors."""
    model = _RecordingInstance(['{"intents": []}'])
    graph: Graph = {
        "nodes": [
            {
                "id": "code",
                "data": {
                    "type": "code",
                    "title": "POST",
                    "code_language": "python3",
                    "code": "def main():\n    raise RuntimeError('POST failed')",
                    "variables": [],
                    "outputs": {},
                    "error_strategy": "fail-branch",
                },
            }
        ],
        "edges": [],
    }
    rules = {"change": "add timeout detail", "continue_on_post_failure": False, "error_status_value": 0}

    assert edit.build_edit_intents(model, rules, graph, edit_target_node_ids=["code"]) == []

    messages = model.calls[0]["prompt_messages"]
    user = str(messages[1].content)
    assert "continue_on_post_failure" in user
    assert "False" in user
    config = json.loads(user.split("    config: ", 1)[1].split("\nEDGES:", 1)[0])
    assert config["error_strategy"] == "fail-branch"
    system = str(messages[0].content)
    assert "stop-on-error" in system
    assert "raise" in system
    assert "Preserve existing error_strategy" in system
    assert "explicitly requested fallback" in system


def test_edit_rule_labels_receive_explicit_session_language_and_preserve_business_value() -> None:
    model = _RecordingInstance(
        [
            json.dumps(
                {
                    "fields": [{"key": "title", "label": "Node title", "type": "text"}],
                    "values": {"title": "字段验证"},
                    "target_node_ids": [],
                }
            )
        ]
    )
    impact = edit.analyze_impact(model, "Please reply in English; preserve 字段验证", _GRAPH, reply_language="en")
    messages = model.calls[0]["prompt_messages"]
    system = messages[0].get_text_content()
    assert "SESSION REPLY LANGUAGE (BCP-47): en" in system
    assert impact["values"]["title"] == "字段验证"


@pytest.mark.parametrize("retry", [None, "same"])
def test_edit_refuses_partial_added_node_when_its_wiring_is_rejected(retry: None | str) -> None:
    """Dropping the failed connection must not turn insertion into a new orphan."""
    batch: Graph = {
        "intents": [
            {
                "op": "create_node",
                "args": {
                    "node_id": "added",
                    "node_type": "template-transform",
                    "config": {"title": "Inserted", "template": "hello", "variables": []},
                },
            },
            {"op": "connect", "args": {"from_node": "missing", "to_node": "added"}},
        ]
    }
    replies = [json.dumps(batch), json.dumps(batch) if retry else "{}"]
    with pytest.raises(ProposalWouldRunWrongError, match="wiring"):
        edit.build_edit_intents(_RecordingInstance(replies), {}, _GRAPH)


def test_edit_exposes_approved_insertion_plan_and_preserves_receipt_contract() -> None:
    from services.dify_builder.plan import WorkflowPlan

    graph: Graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {
                "id": "receipt",
                "data": {
                    "type": "template-transform",
                    "title": "生成回执",
                    "template": "订单号：A-1001；金额：88.00元。",
                    "variables": [],
                },
            },
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "输出回执",
                    "outputs": [
                        {"variable": "receipt", "value_selector": ["receipt", "output"], "value_type": "string"}
                    ],
                },
            },
        ],
        "edges": [{"source": "start", "target": "receipt"}, {"source": "receipt", "target": "end"}],
    }
    plan = WorkflowPlan(
        "添加审阅标记",
        "订单输入",
        "带审阅标记的回执",
        ["在生成回执与输出回执之间插入添加审阅标记，前缀【已生成】，更新 End receipt selector"],
    )
    model = _RecordingInstance(
        [
            json.dumps(
                {
                    "intents": [
                        {
                            "op": "insert_between",
                            "args": {
                                "node_id": "mark",
                                "edge": {"source": "receipt", "target": "end"},
                                "node_type": "template-transform",
                                "config": {
                                    "title": "添加审阅标记",
                                    "template": "【已生成】{{ receipt }}",
                                    "variables": [
                                        {
                                            "variable": "receipt",
                                            "value_selector": ["receipt", "output"],
                                            "value_type": "string",
                                        }
                                    ],
                                },
                            },
                        },
                        {
                            "op": "set_node_config",
                            "args": {"node_id": "end", "path": "outputs.0.value_selector", "value": ["mark", "output"]},
                        },
                    ]
                }
            )
        ]
    )
    intents = edit.build_edit_intents(model, {}, graph, approved_plan=plan, edit_target_node_ids=["receipt", "end"])
    result = graph_ops.filter_applicable(graph, intents).graph
    assert {(e["source"], e["target"]) for e in result["edges"]} == {
        ("start", "receipt"),
        ("receipt", "mark"),
        ("mark", "end"),
    }
    assert result["nodes"][:2] == graph["nodes"][:2]
    assert result["nodes"][2]["data"]["outputs"] == [
        {"variable": "receipt", "value_selector": ["mark", "output"], "value_type": "string"}
    ]
    system, user = model.calls[0]["prompt_messages"]
    assert plan.items[0] in _message_text(user)
    assert plan.output_summary in _message_text(user)


@pytest.fixture
def retained_bypass() -> tuple[Graph, Graph, Graph]:
    graph: Graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {"id": "receipt", "data": {"type": "template-transform", "template": "hello", "variables": []}},
            {"id": "end", "data": {"type": "end", "outputs": []}},
        ],
        "edges": [{"source": "start", "target": "receipt"}, {"source": "receipt", "target": "end"}],
    }
    config = {"title": "Mark", "template": "mark", "variables": []}
    batch = {
        "intents": [
            {"op": "create_node", "args": {"node_id": "mark", "node_type": "template-transform", "config": config}},
            {"op": "connect", "args": {"from_node": "receipt", "to_node": "mark"}},
            {"op": "connect", "args": {"from_node": "mark", "to_node": "end"}},
        ]
    }
    corrected = {
        "intents": [
            {
                "op": "insert_between",
                "args": {
                    "node_id": "mark",
                    "node_type": "template-transform",
                    "config": config,
                    "edge": {"source": "receipt", "target": "end"},
                },
            }
        ]
    }
    return graph, batch, corrected


def test_edit_corrects_retained_bypass_before_returning_insertion(retained_bypass: tuple[Graph, Graph, Graph]) -> None:
    from services.dify_builder.plan import WorkflowPlan

    graph, batch, corrected = retained_bypass
    model = _RecordingInstance(
        [json.dumps(batch), '{"required_insertions":[0],"uncertain":false}', json.dumps(corrected)]
    )
    plan = WorkflowPlan("Insert mark", "Original input", "Marked output", ["Replace receipt→end with receipt→mark→end"])
    intents = edit.build_edit_intents(model, {"change": "Insert mark"}, graph, approved_plan=plan)
    result = graph_ops.filter_applicable(graph, intents).graph
    assert {(e["source"], e["target"]) for e in result["edges"]} == {
        ("start", "receipt"),
        ("receipt", "mark"),
        ("mark", "end"),
    }
    assert graph["edges"] == [{"source": "start", "target": "receipt"}, {"source": "receipt", "target": "end"}]


@pytest.mark.parametrize("retry", ["same", "empty"])
def test_edit_refuses_still_condemned_bypass(retained_bypass: tuple[Graph, Graph, Graph], retry: str) -> None:
    graph, batch, _ = retained_bypass
    assessment = '{"required_insertions":[0],"uncertain":false}'
    replies = [json.dumps(batch), assessment, json.dumps(batch) if retry == "same" else "{}", assessment]
    with pytest.raises(ProposalWouldRunWrongError, match="receipt"):
        edit.build_edit_intents(_RecordingInstance(replies), {"change": "Insert mark; remove old edge"}, graph)


def test_edit_keeps_explicit_parallel_path(retained_bypass: tuple[Graph, Graph, Graph]) -> None:
    graph, batch, _ = retained_bypass
    model = _RecordingInstance([json.dumps(batch), '{"required_insertions":[],"uncertain":false}'])
    intents = edit.build_edit_intents(model, {"change": "Add a parallel mark path; preserve receipt→end"}, graph)
    result = graph_ops.filter_applicable(graph, intents).graph
    assert {(e["source"], e["target"]) for e in result["edges"]} == {
        ("start", "receipt"),
        ("receipt", "end"),
        ("receipt", "mark"),
        ("mark", "end"),
    }
    assert len(model.calls) == 2


@pytest.mark.parametrize("retry_kind", ["isolated", "reclassified"])
def test_insertion_retry_cannot_drop_or_reclassify_the_required_path(
    retained_bypass: tuple[Graph, Graph, Graph], retry_kind: str
) -> None:
    graph, batch, _ = retained_bypass
    retry = {"intents": batch["intents"][:1]} if retry_kind == "isolated" else batch
    model = _RecordingInstance(
        [
            json.dumps(batch),
            '{"required_insertions":[0],"uncertain":false}',
            json.dumps(retry),
            '{"required_insertions":[],"uncertain":false}',
        ]
    )
    with pytest.raises(ProposalWouldRunWrongError, match="receipt"):
        edit.build_edit_intents(model, {"change": "Insert mark"}, graph)


def test_insertion_only_retry_preserves_valid_new_node_config(retained_bypass: tuple[Graph, Graph, Graph]) -> None:
    graph, batch, corrected = retained_bypass
    batch["intents"][0]["args"]["config"] = {
        "title": "Mark",
        "template": "LANG|{{ value }}",
        "variables": [{"variable": "value", "value_selector": ["receipt", "output"], "value_type": "string"}],
    }
    corrected["intents"][0]["args"]["config"] = {"title": "Mark", "template": "LANG|{{ value }}", "variables": []}
    model = _RecordingInstance(
        [
            json.dumps(batch),
            '{"required_insertions":[0],"uncertain":false}',
            json.dumps(corrected),
        ]
    )
    with pytest.raises(ProposalWouldRunWrongError, match="configuration"):
        edit.build_edit_intents(model, {"change": "Insert mark"}, graph)


def test_edit_checks_paths_through_multiple_added_nodes(retained_bypass: tuple[Graph, Graph, Graph]) -> None:
    graph, batch, _ = retained_bypass
    batch["intents"].insert(
        1,
        {
            "op": "create_node",
            "args": {
                "node_id": "mark2",
                "node_type": "template-transform",
                "config": {"template": "second", "variables": []},
            },
        },
    )
    batch["intents"][-1]["args"]["to_node"] = "mark2"
    batch["intents"].append({"op": "connect", "args": {"from_node": "mark2", "to_node": "end"}})
    model = _RecordingInstance([json.dumps(batch), '{"required_insertions":[0],"uncertain":false}', "{}"])
    with pytest.raises(ProposalWouldRunWrongError, match="receipt"):
        edit.build_edit_intents(model, {"change": "Insert two sequential marks"}, graph)


@pytest.mark.parametrize("different_handle", ["sourceHandle", "targetHandle"])
def test_bypass_detection_respects_original_edge_handles(
    retained_bypass: tuple[Graph, Graph, Graph], different_handle: str
) -> None:
    graph, batch, _ = retained_bypass
    graph["edges"][-1][different_handle] = "other-branch"
    after = graph_ops.filter_applicable(graph, [MutationIntent(**i) for i in batch["intents"]]).graph
    assert edit._added_path(graph, after, graph["edges"][-1]) is None


def test_assessment_has_candidate_node_metadata_and_full_plan(retained_bypass: tuple[Graph, Graph, Graph]) -> None:
    from services.dify_builder.plan import WorkflowPlan

    graph, batch, _ = retained_bypass
    graph["nodes"][1]["data"]["title"] = "Original receipt"
    plan = WorkflowPlan("Parallel receipt review", "Receipt input", "Both paths reach End", ["Add review path"])
    model = _RecordingInstance([json.dumps(batch), '{"required_insertions":[],"uncertain":false}'])
    edit.build_edit_intents(model, {}, graph, approved_plan=plan)
    user = json.loads(_message_text(model.calls[-1]["prompt_messages"][1]))
    assert user["approved_plan"]["title"] == "Parallel receipt review"
    assert user["approved_plan"]["input_summary"] == "Receipt input"
    assert any("receipt (template-transform): Original receipt" in n for n in user["nodes"])
    assert any("mark (template-transform): Mark" in n for n in user["nodes"])


def test_unavailable_assessment_does_not_authorize_a_bypass(
    retained_bypass: tuple[Graph, Graph, Graph], monkeypatch: pytest.MonkeyPatch
) -> None:
    graph, batch, _ = retained_bypass

    def unavailable(_model: object, **_kwargs: object) -> str:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(edit.llm, "invoke_text", unavailable)
    with pytest.raises(ProposalWouldRunWrongError, match="Could not verify"):
        edit.build_edit_intents(_RecordingInstance([json.dumps(batch), "{}"]), {"change": "Insert mark"}, graph)


@pytest.mark.parametrize(
    "assessment",
    ["{}", '{"required_insertions":[99],"uncertain":false}', '{"required_insertions":[],"uncertain":true}'],
)
def test_edit_does_not_accept_unassessed_bypass(retained_bypass: tuple[Graph, Graph, Graph], assessment: str) -> None:
    graph, batch, _ = retained_bypass
    model = _RecordingInstance([json.dumps(batch), assessment, json.dumps(batch), assessment])
    with pytest.raises(ProposalWouldRunWrongError):
        edit.build_edit_intents(model, {"change": "Insert mark"}, graph)


def test_edit_still_allows_intentional_isolated_draft_addition() -> None:
    batch: Graph = {
        "intents": [
            {
                "op": "create_node",
                "args": {
                    "node_id": "draft",
                    "node_type": "template-transform",
                    "config": {"title": "Draft", "template": "hello", "variables": []},
                },
            }
        ]
    }
    intents = edit.build_edit_intents(_RecordingInstance([json.dumps(batch)]), {"change": "Add isolated draft"}, _GRAPH)
    assert [i.args["node_id"] for i in intents] == ["draft"]


def test_edit_retry_cannot_remove_rejected_wiring_and_keep_same_isolated_addition() -> None:
    create = {
        "op": "create_node",
        "args": {
            "node_id": "added",
            "node_type": "template-transform",
            "config": {"title": "Inserted", "template": "hello", "variables": []},
        },
    }
    first = {"intents": [create, {"op": "connect", "args": {"from_node": "missing", "to_node": "added"}}]}
    retry = {"intents": [create]}
    with pytest.raises(ProposalWouldRunWrongError, match="wiring"):
        edit.build_edit_intents(_RecordingInstance([json.dumps(first), json.dumps(retry)]), {}, _GRAPH)


def test_edit_retry_can_correct_added_node_wiring_to_existing_anchor() -> None:
    create = {
        "op": "create_node",
        "args": {
            "node_id": "added",
            "node_type": "template-transform",
            "config": {"title": "Inserted", "template": "hello", "variables": []},
        },
    }
    first = {"intents": [create, {"op": "connect", "args": {"from_node": "missing", "to_node": "added"}}]}
    retry = {"intents": [create, {"op": "connect", "args": {"from_node": "llm", "to_node": "added"}}]}
    model = _RecordingInstance([json.dumps(first), json.dumps(retry)])
    intents = edit.build_edit_intents(model, {}, _GRAPH)
    graph = graph_ops.filter_applicable(_GRAPH, intents).graph
    assert [(e["source"], e["target"]) for e in graph["edges"]] == [("llm", "added")]
    assert len(model.calls) == 2
