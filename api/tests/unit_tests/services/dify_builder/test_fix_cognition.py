from core.dify_builder.models import ChecklistError, Diagnosis, NodeOutput, Run
from services.dify_builder.agent import fix


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


_GRAPH = {
    "nodes": [
        {"id": "code1", "data": {"type": "code", "title": "Code"}},
        {"id": "end1", "data": {"type": "end", "title": "End"}},
    ],
    "edges": [],
}
_OUTPUTS = [NodeOutput(node_id="code1", title="Code", status="failed", error="NameError: x", inputs={}, outputs={})]


def test_diagnose_valid():
    m = _FakeInstance(['{"culprit_node_id": "code1", "root_cause": "x is undefined", "severity": "high"}'])
    d = fix.diagnose(m, Run(), _GRAPH, _OUTPUTS)
    assert d.culprit_node_id == "code1"
    assert d.severity == "high"
    assert "undefined" in d.root_cause


def test_diagnose_nonexistent_culprit_falls_back():
    m = _FakeInstance(['{"culprit_node_id": "ghost", "root_cause": "y", "severity": "medium"}'])
    d = fix.diagnose(m, Run(), _GRAPH, _OUTPUTS)
    assert d.culprit_node_id == "code1"  # LLM named a non-existent node -> real failed node


def test_diagnose_bad_severity_coerced():
    m = _FakeInstance(['{"culprit_node_id": "code1", "root_cause": "y", "severity": "catastrophic"}'])
    assert fix.diagnose(m, Run(), _GRAPH, _OUTPUTS).severity == "medium"


def test_diagnose_none_model_degrades_with_real_error():
    d = fix.diagnose(None, Run(), _GRAPH, _OUTPUTS)
    assert d.culprit_node_id == "code1"
    assert "NameError: x" in d.root_cause


def test_diagnose_provider_error_degrades():
    d = fix.diagnose(_BoomInstance(), Run(), _GRAPH, _OUTPUTS)
    assert d.culprit_node_id == "code1"
    assert "unavailable" in d.root_cause


def test_diagnose_checklist_valid():
    errs = [ChecklistError(node_id="llm1", node_type="llm", title="LLM", messages=["metrics required"])]
    g = {"nodes": [{"id": "llm1", "data": {"type": "llm"}}], "edges": []}
    m = _FakeInstance(['{"culprit_node_id": "llm1", "root_cause": "missing metrics", "severity": "medium"}'])
    d = fix.diagnose_checklist(m, errs, g)
    assert d.culprit_node_id == "llm1"
    assert "metrics" in d.root_cause


def test_diagnose_checklist_none_model_degrades():
    errs = [ChecklistError(node_id="llm1", messages=["metrics required"])]
    d = fix.diagnose_checklist(None, errs, {"nodes": [], "edges": []})
    assert d.culprit_node_id == "llm1"
    assert d.root_cause == "metrics required"


_DIAG = Diagnosis(culprit_node_id="code1", root_cause="x is undefined", severity="high")
_RG = {
    "nodes": [
        {"id": "code1", "data": {"type": "code", "title": "Code"}},
        {"id": "end1", "data": {"type": "end", "title": "End"}},
    ],
    "edges": [{"id": "code1-end1", "source": "code1", "target": "end1"}],
}


def test_propose_config_fix_auto_applies_low_risk():
    payload = (
        '{"intents":[{"op":"set_node_config","args":{"node_id":"code1","path":"code",'
        '"value":"def main():\\n    return {}"}}],'
        '"risk":{"level":"low","reason":"config fix","has_external_side_effect":false}}'
    )
    intents, risk = fix.propose_repair(_FakeInstance([payload]), _DIAG, _RG)
    assert len(intents) == 1
    assert intents[0].op == "set_node_config"
    assert risk.level == "low"


def test_propose_structural_forced_high():
    payload = (
        '{"intents":[{"op":"create_node","args":{"node_type":"llm","config":{},"node_id":"llm2"}},'
        '{"op":"connect","args":{"from_node":"llm2","to_node":"end1"}}],'
        '"risk":{"level":"low","reason":"add node","has_external_side_effect":false}}'
    )
    intents, risk = fix.propose_repair(_FakeInstance([payload]), _DIAG, _RG)
    assert len(intents) == 2
    assert risk.level == "high"  # any structural op forces high -> human review


def test_propose_dangling_ref_reprompts_then_recovers():
    bad = (
        '{"intents":[{"op":"connect","args":{"from_node":"code1","to_node":"ghost"}}],'
        '"risk":{"level":"low","reason":"x"}}'
    )
    good = (
        '{"intents":[{"op":"connect","args":{"from_node":"code1","to_node":"end1"}}],'
        '"risk":{"level":"low","reason":"x"}}'
    )
    intents, risk = fix.propose_repair(_FakeInstance([bad, good]), _DIAG, _RG)
    assert len(intents) == 1
    assert intents[0].args["to_node"] == "end1"
    assert risk.level == "high"  # connect is structural


def test_propose_invalid_twice_surfaces_to_human():
    bad = '{"intents":[{"op":"connect","args":{"from_node":"code1","to_node":"ghost"}}],"risk":{"level":"low"}}'
    intents, risk = fix.propose_repair(_FakeInstance([bad, bad]), _DIAG, _RG)
    assert intents == []
    assert risk.level == "high"
    assert "manual" in risk.reason.lower()


def test_propose_none_model_surfaces_to_human():
    intents, risk = fix.propose_repair(None, _DIAG, _RG)
    assert intents == []
    assert risk.level == "high"


def test_propose_provider_error_surfaces():
    intents, risk = fix.propose_repair(_BoomInstance(), _DIAG, _RG)
    assert intents == []
    assert risk.level == "high"
