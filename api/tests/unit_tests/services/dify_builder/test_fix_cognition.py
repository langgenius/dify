import json

from core.dify_builder.models import ChecklistError, Diagnosis, NodeOutput, Run
from services.dify_builder import credentials
from services.dify_builder.agent import fix, graph_prompt
from services.dify_builder.preflight import preflight_errors


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
# The CULPRIT node is engine-valid; ``end1`` is deliberately left as it always
# was -- not startable. ``preflight.new_preflight_problems`` gives a node whose
# DATA the batch wrote no exemption, so a ``set_node_config`` on a culprit that
# was never startable would fail for a reason that has nothing to do with what
# these tests are about (risk classification and the re-prompt budget). ``end1``
# is only ever CONNECTED to, never written, so its defect must keep its
# exemption -- which is exactly what these fixtures now also guard.
_RG = {
    "nodes": [
        {
            "id": "code1",
            "data": {
                "type": "code",
                "title": "Code",
                "code": "def main():\n    return {}",
                "code_language": "python3",
                "outputs": {},
                "variables": [],
            },
        },
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


# Same split as ``_RG``: the culprit is startable, ``end1`` is not and is never
# written.
_HTTP_GRAPH = {
    "nodes": [
        {
            "id": "http1",
            "data": {
                "type": "http-request",
                "title": "HTTP",
                "method": "get",
                "url": "https://example.test/old",
                "authorization": {"type": "no-auth"},
                "headers": "",
                "params": "",
                "body": {"type": "none", "data": []},
            },
        },
        {"id": "end1", "data": {"type": "end", "title": "End"}},
    ],
    "edges": [{"id": "http1-end1", "source": "http1", "target": "end1"}],
}


def test_propose_external_config_forced_high():
    payload = (
        '{"intents":[{"op":"set_node_config","args":{"node_id":"http1","path":"url",'
        '"value":"https://example.com"}}],'
        '"risk":{"level":"low","reason":"config fix","has_external_side_effect":false}}'
    )
    diag = Diagnosis(culprit_node_id="http1", root_cause="bad url", severity="high")
    intents, risk = fix.propose_repair(_FakeInstance([payload]), diag, _HTTP_GRAPH)
    assert len(intents) == 1
    assert intents[0].op == "set_node_config"
    assert risk.level == "high"  # http-request node touched -> external side effect, even config-only


def test_propose_structural_forced_high():
    """Also the guard for the ``connect`` exclusion: ``end1`` is already refused
    by the engine and this batch only WIRES to it. Counting a connect's
    endpoints as written would make ``end1``'s pre-existing defect veto the
    whole repair, and this test would silently become "surfaces to human"."""
    from services.dify_builder.preflight import preflight_errors

    assert preflight_errors(_RG)  # ``end1`` is not startable, and nothing here fixes it
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


def test_diagnose_none_model_surfaces_launch_error_when_no_failed_nodes():
    """A launch failure (verify threw before any node ran: empty node_outputs,
    message on run.error) must surface that error in the degraded diagnosis
    instead of the blind 'Automatic diagnosis unavailable.'"""
    run = Run(status="failed", per_node=[], error="query is required in input form")
    d = fix.diagnose(None, run, _GRAPH, [])
    assert "in input form" in d.root_cause


# ---- credentials must not reach the repair prompt ----
#
# A failing http-request node is one of the likeliest culprits there is, and
# ``_culprit_config`` inlines its whole ``data``. See
# services/dify_builder/credentials.py for the two halves of the guard.


class _RecordingInstance:
    """Like ``_FakeInstance``, but keeps the prompt it was handed."""

    def __init__(self, replies):
        self._replies = list(replies)
        self.calls: list[dict] = []

    def invoke_llm(self, **kwargs):
        self.calls.append(kwargs)
        return _Result(self._replies.pop(0))


_SECRET_HTTP_GRAPH = {
    "nodes": [
        {
            "id": "http1",
            "data": {
                "type": "http-request",
                "title": "HTTP",
                "url": "https://example.test/score",
                "authorization": {
                    "type": "api-key",
                    "config": {"type": "bearer", "header": "X-Auth", "api_key": "sk-live-9f3c-SECRET"},
                },
                "headers": "Authorization: Bearer tok-999-SECRET",
            },
        },
        {"id": "end1", "data": {"type": "end", "title": "End"}},
    ],
    "edges": [{"id": "http1-end1", "source": "http1", "target": "end1"}],
}


def test_culprit_config_withholds_the_nodes_secrets():
    block = fix._culprit_config("http1", _SECRET_HTTP_GRAPH)

    assert "sk-live-9f3c-SECRET" not in block
    assert "tok-999-SECRET" not in block
    assert credentials.REDACTED in block
    # structure the repair model still needs
    assert "X-Auth" in block
    assert "https://example.test/score" in block


def test_propose_repair_prompt_does_not_carry_the_culprits_credentials():
    payload = (
        '{"intents":[{"op":"set_node_config","args":{"node_id":"http1","path":"url",'
        '"value":"https://example.com"}}],'
        '"risk":{"level":"low","reason":"config fix","has_external_side_effect":false}}'
    )
    m = _RecordingInstance([payload])
    diag = Diagnosis(culprit_node_id="http1", root_cause="401 from the scoring API", severity="high")

    fix.propose_repair(m, diag, _SECRET_HTTP_GRAPH)

    prompt = "\n".join(str(msg.content) for msg in m.calls[0]["prompt_messages"])
    assert "sk-live-9f3c-SECRET" not in prompt
    assert "tok-999-SECRET" not in prompt
    assert credentials.REDACTED in prompt


def test_culprit_config_survives_a_node_whose_data_is_not_a_mapping():
    graph = {"nodes": [{"id": "odd", "data": "not-a-dict"}], "edges": []}

    assert fix._culprit_config("odd", graph) == "{}"


# ---- an over-budget culprit is never shown half-rendered ----
#
# The op schema Fix now shares with Edit tells the model to re-send an array's
# existing elements byte-identical "as GRAPH shows them". That is only honest
# if what GRAPH showed is whole. ``_culprit_config`` used to hand the prompt a
# Python repr cut at 1500 characters, so a long ``cases`` array arrived severed
# mid-value and the model would have completed it from imagination -- while
# believing, and looking like, it was copying. Whole keys are dropped and named
# instead.


def _oversized_if_else_node() -> dict:
    """An if-else whose ``cases`` alone blows the budget several times over."""
    cases = [
        {
            "case_id": f"case{i}",
            "logical_operator": "and",
            "conditions": [
                {
                    "id": f"c{i}",
                    "varType": "string",
                    "variable_selector": ["start1", "text"],
                    "comparison_operator": "is",
                    "value": f"a rather long expected value number {i}" * 3,
                }
            ],
        }
        for i in range(12)
    ]
    return {"id": "branch1", "data": {"type": "if-else", "title": "Score", "cases": cases}}


def test_an_over_budget_culprit_config_drops_the_whole_key_and_names_it():
    graph = {"nodes": [_oversized_if_else_node()], "edges": []}

    block = fix._culprit_config("branch1", graph)

    assert len(json.dumps(graph["nodes"][0]["data"], ensure_ascii=False)) > graph_prompt.NODE_CONFIG_LIMIT
    kept, marker, dropped = block.partition(graph_prompt.TRUNCATION_MARKER)
    assert marker  # it did not fit, so something had to go
    assert dropped == "cases"  # ...and the prompt says which key went
    # Nothing is half-rendered: what survives is whole, parseable JSON, and no
    # fragment of a case leaked into it.
    assert json.loads(kept) == {"type": "if-else", "title": "Score"}
    assert "case_id" not in block


def test_a_within_budget_culprit_config_is_rendered_whole_as_json():
    graph = {"nodes": [{"id": "code1", "data": {"type": "code", "title": "Code", "code": "x = 1"}}], "edges": []}

    block = fix._culprit_config("code1", graph)

    assert graph_prompt.TRUNCATION_MARKER not in block
    assert json.loads(block) == {"type": "code", "title": "Code", "code": "x = 1"}


# ---- the node-data half of the check, mirroring Edit ----
#
# A repair that applies cleanly but leaves a node ``Graph.init`` refuses is the
# worst outcome Fix has: it reaches the approval gate looking like a real fix,
# the human approves it, and the write dies at ``apply_repair``'s preflight.
# ``==`` is the error used here because no normalizer heals it and none may --
# graphon's string equality is ``is`` and its number equality is ``=``, so the
# ASCII form is ambiguous between them (``>=`` is unambiguous and IS healed, so
# it can no longer prove anything).

_IF_ELSE_GRAPH = {
    "nodes": [
        {
            "id": "start1",
            "type": "custom",
            "data": {
                "type": "start",
                "title": "Start",
                "variables": [
                    {"variable": "score", "type": "number", "label": "Score", "required": True, "options": []}
                ],
            },
        },
        {
            "id": "branch1",
            "type": "custom",
            "data": {
                "type": "if-else",
                "title": "Branch",
                "cases": [
                    {
                        "case_id": "true",
                        "logical_operator": "and",
                        "conditions": [
                            {
                                "id": "c1",
                                "varType": "number",
                                "variable_selector": ["start1", "score"],
                                "comparison_operator": "=",
                                "value": "60",
                            }
                        ],
                    }
                ],
            },
        },
    ],
    "edges": [{"id": "e1", "source": "start1", "target": "branch1"}],
}
_IF_ELSE_DIAG = Diagnosis(culprit_node_id="branch1", root_cause="threshold is wrong", severity="medium")


def _operator_repair(operator: str) -> str:
    return (
        '{"intents":[{"op":"set_node_config","args":{"node_id":"branch1",'
        f'"path":"cases.0.conditions.0.comparison_operator","value":"{operator}"}}}}],'
        '"risk":{"level":"low","reason":"config fix","has_external_side_effect":false}}'
    )


def test_propose_repair_reprompts_on_a_node_the_engine_would_refuse_and_recovers():
    m = _RecordingInstance([_operator_repair("=="), _operator_repair("≥")])

    intents, risk = fix.propose_repair(m, _IF_ELSE_DIAG, _IF_ELSE_GRAPH)

    assert len(m.calls) == 2  # structurally applicable, and STILL burned the re-prompt
    assert [i.args["value"] for i in intents] == ["≥"]
    assert risk.level == "low"


def test_the_fix_reprompt_quotes_the_engines_own_words():
    m = _RecordingInstance([_operator_repair("=="), _operator_repair("≥")])

    fix.propose_repair(m, _IF_ELSE_DIAG, _IF_ELSE_GRAPH)

    retry_prompt = m.calls[1]["prompt_messages"][1].content
    assert "the draft would then not start: node 'branch1' (if-else): " in retry_prompt
    assert "cases.0.conditions.0.comparison_operator" in retry_prompt


def test_a_repair_the_engine_refuses_twice_surfaces_to_the_human():
    m = _RecordingInstance([_operator_repair("=="), _operator_repair("==")])

    intents, risk = fix.propose_repair(m, _IF_ELSE_DIAG, _IF_ELSE_GRAPH)

    assert len(m.calls) == 2
    assert intents == []  # never handed to the gate as if it were a fix
    assert risk.level == "high"
    assert "manual" in risk.reason.lower()


def test_a_repair_the_engine_accepts_never_spends_the_reprompt():
    m = _RecordingInstance([_operator_repair("≥")])

    intents, _risk = fix.propose_repair(m, _IF_ELSE_DIAG, _IF_ELSE_GRAPH)

    assert len(m.calls) == 1
    assert len(intents) == 1


def test_a_pre_existing_broken_node_does_not_veto_a_repair_elsewhere():
    """New problems only: the bare ``code1`` stand-in is invalid before the
    repair and after it, so it must not cost the re-prompt or the fix."""
    graph = {"nodes": [*_IF_ELSE_GRAPH["nodes"], {"id": "code1", "data": {"type": "code"}}], "edges": []}
    m = _RecordingInstance([_operator_repair("≥")])

    intents, _risk = fix.propose_repair(m, _IF_ELSE_DIAG, graph)

    assert len(m.calls) == 1
    assert len(intents) == 1


def test_a_repair_that_breaks_its_already_invalid_culprit_further_is_rejected():
    """Fix's MAIN path, and the reason the new-problems rule is keyed on pydantic
    error locations rather than on node identity.

    For the whole ESQ1-302 / ESQ1-303 / F4 family the culprit is by definition
    already preflight-invalid -- that is why Fix was called. A rule that exempted
    an already-refused node from every later verdict would give ``propose_repair``
    zero node-data coverage on the one node it is repairing: this repair, which
    leaves the culprit refused at a field it was fine at before, would pass the
    dry run AND the port and be written and reported as applied.
    """
    culprit = {"id": "code1", "type": "custom", "data": {"type": "code", "title": "Code", "code_language": "python3"}}
    graph = {"nodes": [culprit], "edges": []}
    assert len(preflight_errors(graph)) == 1  # already refused before the repair
    breaks_it_further = (
        '{"intents":[{"op":"set_node_config","args":{"node_id":"code1","path":"code_language",'
        '"value":"klingon"}}],"risk":{"level":"low","reason":"x","has_external_side_effect":false}}'
    )
    m = _RecordingInstance([breaks_it_further, breaks_it_further])

    intents, risk = fix.propose_repair(m, Diagnosis(culprit_node_id="code1", root_cause="x", severity="high"), graph)

    assert len(m.calls) == 2  # it was refused, so the re-prompt fired
    assert "code_language" in m.calls[1]["prompt_messages"][1].content
    assert intents == []  # ...and refused again, so it never reaches the gate
    assert risk.level == "high"


# ---- a connect from a branch node carries the handle that node declares ----
#
# Triage edit-branch-failure-2026-09-22, option (f1). ``fix._OP_SCHEMA`` listed
# ``connect: {from_node, to_node}`` and ``fix._graph_context`` printed no
# handles, so a repair that wired anything from an if-else /
# question-classifier / human-input node fell back to the ``"source"`` handle,
# ``graph_ops.apply_connect`` refused it, that refusal spent the single
# corrective re-prompt, and ``propose_repair`` returned ``_no_fix()`` -- the
# repair could not be proposed at all, however right it was. Edit was given the
# same handles in 197cd9c5ad; both now render them out of ``graph_prompt``.
#
# The change itself is prompt text, so the regression cover for it IS the two
# prompt assertions in the last test here -- the schema naming ``source_handle``
# and the context printing the handles. The three behavioural tests around them
# are what makes those assertions mean something: they show the engine
# accepting the connect the prompt now makes writable and refusing the one it
# used to be the only way to write.

_BRANCH_GRAPH = {
    "nodes": [
        {
            "id": "start1",
            "type": "custom",
            "data": {
                "type": "start",
                "title": "Start",
                "variables": [
                    {"variable": "score", "type": "number", "label": "Score", "required": True, "options": []}
                ],
            },
        },
        {
            "id": "branch1",
            "type": "custom",
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
                                "variable_selector": ["start1", "score"],
                                "comparison_operator": "≥",
                                "value": "60",
                            }
                        ],
                    }
                ],
            },
        },
        {
            "id": "pass1",
            "type": "custom",
            "data": {"type": "template-transform", "title": "Pass", "template": "pass", "variables": []},
        },
        {
            "id": "excellent1",
            "type": "custom",
            "data": {"type": "template-transform", "title": "Excellent", "template": "excellent", "variables": []},
        },
    ],
    "edges": [
        {"id": "e1", "source": "start1", "target": "branch1"},
        {"id": "e2", "source": "branch1", "target": "pass1", "sourceHandle": "true"},
    ],
}
_BRANCH_DIAG = Diagnosis(culprit_node_id="branch1", root_cause="the else arm goes nowhere", severity="medium")


def _branch_connect(source_handle: str | None) -> str:
    """A repair wiring the orphan node onto the branch's ELSE arm, with or
    without the handle the engine demands."""
    args: dict = {"from_node": "branch1", "to_node": "excellent1"}
    if source_handle is not None:
        args["source_handle"] = source_handle
    return json.dumps(
        {
            "intents": [{"op": "connect", "args": args}],
            "risk": {"level": "low", "reason": "wire the else arm", "has_external_side_effect": False},
        }
    )


def test_a_branch_connect_with_a_declared_handle_is_accepted_first_time():
    m = _RecordingInstance([_branch_connect("false")])

    intents, risk = fix.propose_repair(m, _BRANCH_DIAG, _BRANCH_GRAPH)

    assert len(m.calls) == 1  # accepted outright: the one re-prompt was never spent
    assert [(i.op, i.args["source_handle"]) for i in intents] == [("connect", "false")]
    assert risk.level == "high"  # a connect is structural -> the human still sees it


def test_a_branch_connect_without_a_handle_is_refused_and_the_retry_recovers_it():
    m = _RecordingInstance([_branch_connect(None), _branch_connect("false")])

    intents, _risk = fix.propose_repair(m, _BRANCH_DIAG, _BRANCH_GRAPH)

    assert len(m.calls) == 2  # the handle-less connect was rejected by the engine's own check
    retry_prompt = m.calls[1]["prompt_messages"][1].content
    assert "has no handle 'source'" in retry_prompt
    assert "['true', 'false']" in retry_prompt
    assert [i.args["source_handle"] for i in intents] == ["false"]


def test_a_handle_less_branch_connect_twice_still_surfaces_to_the_human():
    """The dead end itself is unchanged -- a model that ignores the rule twice
    still ends at ``_no_fix()``. What changed is that it is now reachable only
    by ignoring the rule: before, EVERY Fix branch connect landed here,
    whatever the model wrote."""
    m = _RecordingInstance([_branch_connect(None), _branch_connect(None)])

    intents, risk = fix.propose_repair(m, _BRANCH_DIAG, _BRANCH_GRAPH)

    assert len(m.calls) == 2
    assert intents == []
    assert risk.level == "high"
    assert "manual" in risk.reason.lower()


def test_the_repair_prompt_states_the_handle_rule_and_shows_the_handles():
    """The prompt half of the three tests above, which are its behaviour.

    On its own ``assert "source_handle" in _OP_SCHEMA`` pins a wording and
    proves nothing; what makes it meaningful is that the same connect is
    accepted with a declared handle and refused without one.
    """
    assert "source_handle" in fix._OP_SCHEMA
    assert "if-else" in fix._OP_SCHEMA

    context = fix._graph_context(_BRANCH_GRAPH)

    assert "  branch1 (if-else): Score handles=['true', 'false']" in context
    assert "  branch1 -[true]-> pass1" in context
    assert "  start1 -> branch1" in context  # a default handle stays unnamed


# ---- parity with Edit: a repair the guards condemn surfaces WITH its reason ----
#
# Fix already refuses to hand on a batch carrying any rejection (its retry ends
# in ``_no_fix()``), so unlike Edit it never had a fallback that could write one.
# What it did have is a blind surface: the engine-grounded reason was discarded
# and the user got "No safe automatic fix found" with nothing to act on. A guard
# Edit explains and Fix merely implies is the inconsistency Task 8 exists to
# stop.

_REJOIN_GRAPH = {
    "nodes": [
        {
            "id": "node1",
            "data": {
                "type": "start",
                "title": "Start",
                "variables": [
                    {"variable": "score", "type": "number", "label": "Score", "required": True, "options": []}
                ],
            },
        },
        {
            "id": "node2",
            "data": {
                "type": "if-else",
                "title": "Check",
                "cases": [
                    {
                        "case_id": "true",
                        "logical_operator": "and",
                        "conditions": [
                            {
                                "id": "c1",
                                "varType": "number",
                                "variable_selector": ["node1", "score"],
                                "comparison_operator": "=",
                                "value": "60",
                            }
                        ],
                    }
                ],
            },
        },
        {"id": "node3", "data": {"type": "template-transform", "title": "Pass", "template": "pass", "variables": []}},
        {
            "id": "node5",
            "data": {
                "type": "variable-aggregator",
                "title": "Merge",
                "output_type": "string",
                "variables": [["node3", "output"]],
            },
        },
        {"id": "node6", "data": {"type": "end", "title": "End", "outputs": [{"variable": "r", "value_selector": []}]}},
    ],
    "edges": [
        {"id": "e1", "source": "node1", "target": "node2", "sourceHandle": "source"},
        {"id": "e2", "source": "node2", "target": "node3", "sourceHandle": "true"},
        {"id": "e4", "source": "node3", "target": "node5", "sourceHandle": "source"},
        {"id": "e6", "source": "node5", "target": "node6", "sourceHandle": "source"},
    ],
}

_REJOIN_DIAG = Diagnosis(culprit_node_id="node2", root_cause="the high branch is missing", severity="high")

_UNFED_BRANCH_REPAIR = json.dumps(
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
        ],
        "risk": {"level": "low", "reason": "adds a branch", "has_external_side_effect": False},
    }
)

_CLOBBERING_REPAIR = json.dumps(
    {
        "intents": [
            {
                "op": "set_node_config",
                "args": {
                    "node_id": "node2",
                    "path": "cases",
                    "value": [
                        {
                            "case_id": "excellent",
                            "logical_operator": "and",
                            "conditions": [
                                {"variable_selector": ["node1", "score"], "comparison_operator": ">=", "value": 90}
                            ],
                        },
                        {
                            "case_id": "true",
                            "logical_operator": "and",
                            "conditions": [
                                {"variable_selector": ["node1", "score"], "comparison_operator": ">=", "value": 60}
                            ],
                        },
                    ],
                },
            }
        ],
        "risk": {"level": "low", "reason": "adds a case", "has_external_side_effect": False},
    }
)


def test_a_repair_that_leaves_an_aggregator_unfed_surfaces_with_the_reason():
    """The rejoin guard through Fix. Nothing is staged, and the reason names
    the aggregator, the new node and the selector to append -- so the human at
    the gate has something to act on instead of "no safe fix found"."""
    m = _FakeInstance([_UNFED_BRANCH_REPAIR, _UNFED_BRANCH_REPAIR])

    intents, risk = fix.propose_repair(m, _REJOIN_DIAG, _REJOIN_GRAPH)

    assert intents == []
    assert risk.level == "high"
    assert "node5" in risk.reason
    assert "node7" in risk.reason
    assert '["node7", "output"]' in risk.reason


def test_a_repair_that_clobbers_an_array_surfaces_with_the_reason():
    """The identity guard through Fix, on the literal S6 rewrite: both cases
    keep their ``case_id`` and the surviving condition's ``id`` is gone."""
    m = _FakeInstance([_CLOBBERING_REPAIR, _CLOBBERING_REPAIR])

    intents, risk = fix.propose_repair(m, _REJOIN_DIAG, _REJOIN_GRAPH)

    assert intents == []
    assert "node2" in risk.reason
    assert "c1" in risk.reason


def test_a_purely_structural_refusal_keeps_the_generic_surface_reason():
    """The distinction round 2 established, in the one place Fix has it: only a
    would-run-wrong verdict replaces the surface text. A structural refusal --
    which DROPPED its own intent and says nothing about what remains -- still
    ends at the same generic "no safe fix" the gate has always shown."""
    ghost = json.dumps(
        {
            "intents": [{"op": "set_node_config", "args": {"node_id": "ghost", "path": "code", "value": "x"}}],
            "risk": {"level": "low", "reason": "r", "has_external_side_effect": False},
        }
    )
    m = _FakeInstance([ghost, ghost])

    intents, risk = fix.propose_repair(m, _DIAG, _RG)

    assert intents == []
    assert risk.reason.startswith("No safe automatic fix found")
    assert "node5" not in risk.reason


def test_a_repair_that_answers_the_guard_on_the_retry_is_staged_as_normal():
    """The corrective re-prompt still does its job: a second attempt that
    extends the aggregator is a real fix and is staged."""
    rejoined = json.dumps(
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
                        "value": [["node3", "output"], ["node7", "output"]],
                    },
                },
            ],
            "risk": {"level": "low", "reason": "adds a branch", "has_external_side_effect": False},
        }
    )
    m = _FakeInstance([_UNFED_BRANCH_REPAIR, rejoined])

    intents, risk = fix.propose_repair(m, _REJOIN_DIAG, _REJOIN_GRAPH)

    assert len(intents) == 4
    assert risk.level == "high"  # structural, so it goes to the approval gate -- but it IS staged
