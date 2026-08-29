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

    def invoke_llm(self, *, prompt_messages, model_parameters=None, stop=None, stream=True, **kw):  # noqa: ARG002
        return _Result(self._replies.pop(0))


class _BoomInstance:
    def invoke_llm(self, *, prompt_messages, model_parameters=None, stop=None, stream=True, **kw):  # noqa: ARG002
        raise RuntimeError("provider down")


_GRAPH = {"nodes": [{"id": "llm", "data": {"type": "llm", "title": "LLM"}}], "edges": []}


def test_analyze_impact_returns_fields_values_targets():
    m = _FakeInstance([json.dumps({
        "fields": [{"key": "tone", "label": "Tone", "type": "text"}],
        "values": {"tone": "formal"}, "target_node_ids": ["llm", "ghost"]})])
    out = edit.analyze_impact(m, "make formal", _GRAPH)
    assert out["values"] == {"tone": "formal"}
    assert out["target_node_ids"] == ["llm"]  # unknown id dropped


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


def test_propose_edit_plan_bullets():
    m = _FakeInstance([json.dumps({"plan": ["Tighten prompt"]})])
    assert edit.propose_edit_plan(m, {"tone": "formal"}, _GRAPH) == ["Tighten prompt"]


def test_propose_edit_plan_none_model_degrades():
    assert edit.propose_edit_plan(None, {"tone": "formal"}, _GRAPH) == ["Apply the requested edit"]


def test_propose_edit_plan_provider_error_degrades():
    out = edit.propose_edit_plan(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out == ["Apply the requested edit"]


def test_build_edit_intents_validates_and_drops_bad():
    m = _FakeInstance([json.dumps({"intents": [
        {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Formal LLM"}},
        {"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})])
    out = edit.build_edit_intents(m, {"tone": "formal"}, _GRAPH)
    assert [i.args["node_id"] for i in out] == ["llm"]  # bad node dropped by filter_applicable


def test_build_edit_intents_degrades_to_empty_on_none():
    assert edit.build_edit_intents(None, {}, _GRAPH) == []


def test_build_edit_intents_provider_error_degrades_to_empty():
    out = edit.build_edit_intents(_BoomInstance(), {"tone": "formal"}, _GRAPH)
    assert out == []


def test_build_edit_intents_total_reject_reprompts_then_recovers():
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    good = json.dumps({"intents": [
        {"op": "set_node_config", "args": {"node_id": "llm", "path": "title", "value": "Formal LLM"}}]})
    out = edit.build_edit_intents(_FakeInstance([bad, good]), {"tone": "formal"}, _GRAPH)
    assert [i.args["node_id"] for i in out] == ["llm"]


def test_build_edit_intents_total_reject_twice_returns_empty():
    bad = json.dumps({"intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "x", "value": 1}}]})
    out = edit.build_edit_intents(_FakeInstance([bad, bad]), {"tone": "formal"}, _GRAPH)
    assert out == []
