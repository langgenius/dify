import json

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
