"""Port of placeholder_agent_test.go + the placeholder-agent slice of seam_test.go.

Mirrors dify-enterprise/server/pkg/enterprise/biz/dify_builder/placeholder_agent_test.go:
``TestPlaceholderAgent_ProposeRepair_ReplacesCulpritCode``,
``TestPlaceholderAgent_DiagnoseChecklist_PicksFirstErrorWithMessages``,
``TestPlaceholderAgent_DiagnoseChecklist_NoMessagesAnywhere_ReturnsGenericCause``.

The full-flow ``TestSeam_AnyConformingAgent_DrivesFlowToTerminal`` (running
``PlaceholderAgent`` through the ``Runner`` end-to-end) belongs to Task 9's
``test_fix_flow.py`` acceptance test; here we only assert the typing seam
(``PlaceholderAgent`` structurally satisfies ``DifyBuilderAgent``), the same
narrower scope ``test_ports.py``'s ``_StubAgent`` seam check covers for a
throwaway conformer.
"""

from core.dify_builder.models import ChecklistError, Graph, NodeOutput, Run
from core.dify_builder.placeholder_agent import FIXED_CODE, PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent


def test_placeholder_agent_satisfies_dify_builder_agent_protocol():
    assert isinstance(PlaceholderAgent(), DifyBuilderAgent)


def test_fixed_code_matches_the_go_fixture_byte_for_byte():
    assert FIXED_CODE == 'def main() -> dict:\n    return {"result": "ok"}'


def test_diagnose_points_at_first_failed_node():
    a = PlaceholderAgent()
    outputs = [
        NodeOutput(node_id="start", status="success"),
        NodeOutput(node_id="code-1", status="failed", error="boom"),
        NodeOutput(node_id="end", status="skip"),
    ]
    d = a.diagnose(Run(), Graph(), outputs)
    assert d.culprit_node_id == "code-1"
    assert d.root_cause == "Code node raised at runtime"
    assert d.severity == "high"


def test_diagnose_falls_back_to_output_when_nothing_failed():
    a = PlaceholderAgent()
    d = a.diagnose(Run(), Graph(), [NodeOutput(node_id="start", status="success")])
    assert d.culprit_node_id == "output"


def test_propose_repair_replaces_culprit_code():
    a = PlaceholderAgent()
    outputs = [NodeOutput(node_id="code-1", status="failed", error="boom")]
    d = a.diagnose(Run(), Graph(), outputs)
    assert d.culprit_node_id == "code-1"

    intents, risk = a.propose_repair(d, Graph())

    assert len(intents) == 1
    it = intents[0]
    assert it.op == "set_node_config"
    assert it.args["node_id"] == "code-1"
    assert it.args["path"] == "code"
    assert isinstance(it.args["value"], str)
    assert it.args["value"] == FIXED_CODE
    assert risk.level == "low"
    assert risk.reason == "config-only fix"
    assert risk.has_external_side_effect is False


def test_diagnose_checklist_picks_first_error_with_messages():
    a = PlaceholderAgent()
    errors = [
        ChecklistError(node_id="n1", unconnected=True),  # no messages, skipped
        ChecklistError(node_id="n2", messages=["missing required field 'metrics'"]),
        ChecklistError(node_id="n3", messages=["unused, should not be reached"]),
    ]
    d = a.diagnose_checklist(errors, Graph())
    assert d.culprit_node_id == "n2"
    assert d.root_cause == "missing required field 'metrics'"
    assert d.severity == "medium"


def test_diagnose_checklist_no_messages_anywhere_returns_generic_cause():
    a = PlaceholderAgent()
    errors = [ChecklistError(node_id="n1", unconnected=True)]
    d = a.diagnose_checklist(errors, Graph())
    assert d.culprit_node_id == ""
    assert d.root_cause == "Checklist error"
    assert d.severity == "medium"


def test_diagnose_checklist_empty_errors_returns_generic_cause():
    a = PlaceholderAgent()
    d = a.diagnose_checklist([], Graph())
    assert d.culprit_node_id == ""
    assert d.root_cause == "Checklist error"
    assert d.severity == "medium"


def test_generate_mock_inputs_returns_canned_query():
    a = PlaceholderAgent()
    assert a.generate_mock_inputs({}, {}) == {"query": "mock"}


def test_analyze_goal_returns_full_requirements_shape():
    from core.dify_builder.placeholder_agent import PlaceholderAgent

    analysis = PlaceholderAgent().analyze_goal("Build a quarterly report workflow")
    assert set(analysis.keys()) == {"fields", "values"}
    assert {f["key"] for f in analysis["fields"]} == {
        "report_types",
        "audience",
        "currency",
        "metrics",
        "output",
        "prefer_audited",
    }
    assert set(analysis["values"].keys()) == {
        "report_types",
        "audience",
        "currency",
        "metrics",
        "output",
        "prefer_audited",
    }
    assert analysis["values"]["currency"] == "USD"
    assert analysis["values"]["prefer_audited"] is True


def test_propose_plan_v1_and_bind_resources_return_ordered_strings():
    from core.dify_builder.placeholder_agent import PlaceholderAgent

    a = PlaceholderAgent()
    v1 = a.propose_plan_v1({"currency": "USD"})
    assert v1
    assert all(isinstance(x, str) for x in v1)
    v2 = a.bind_resources(v1, ["kb-company"], "audited")
    assert v2
    assert all(isinstance(x, str) for x in v2)


def test_discover_resources_returns_one_ready_option():
    from core.dify_builder.placeholder_agent import PlaceholderAgent

    opts = PlaceholderAgent().discover_resources(["Retrieve", "Summarize"])
    assert len(opts) == 1
    assert opts[0].readiness == "ready"
    assert opts[0].kind == "knowledge"


def test_build_nodes_emits_start_knowledge_llm_end_with_valid_connects():
    from core.dify_builder.placeholder_agent import (
        BUILD_END_ID,
        BUILD_KNOWLEDGE_ID,
        BUILD_LLM_ID,
        BUILD_START_ID,
        PlaceholderAgent,
    )

    intents = PlaceholderAgent().build_nodes(["Retrieve", "Summarize", "Emit"])
    creates = [i for i in intents if i.op == "create_node"]
    connects = [i for i in intents if i.op == "connect"]
    assert [i.args["node_id"] for i in creates] == [
        BUILD_START_ID,
        BUILD_KNOWLEDGE_ID,
        BUILD_LLM_ID,
        BUILD_END_ID,
    ]
    assert [i.args["node_type"] for i in creates] == ["start", "knowledge-retrieval", "llm", "end"]
    assert [(i.args["from_node"], i.args["to_node"]) for i in connects] == [
        (BUILD_START_ID, BUILD_KNOWLEDGE_ID),
        (BUILD_KNOWLEDGE_ID, BUILD_LLM_ID),
        (BUILD_LLM_ID, BUILD_END_ID),
    ]
    # every connect references only nodes created earlier in the sequence:
    created_so_far: set[str] = set()
    for i in intents:
        if i.op == "create_node":
            created_so_far.add(i.args["node_id"])
        else:
            assert i.args["from_node"] in created_so_far
            assert i.args["to_node"] in created_so_far
    # each create_node config carries a real node_defaults baseline:
    assert creates[2].args["config"]["model"]["mode"] == "chat"


def test_propose_build_repair_targets_the_llm_node():
    from core.dify_builder.placeholder_agent import BUILD_LLM_ID, PlaceholderAgent

    intents = PlaceholderAgent().propose_build_repair(["start", "knowledge_retrieval", "llm", "end"])
    assert len(intents) == 1
    assert intents[0].op == "set_node_config"
    assert intents[0].args["node_id"] == BUILD_LLM_ID


def test_placeholder_learn_from_build_returns_descriptor():
    from core.dify_builder.placeholder_agent import PlaceholderAgent

    out = PlaceholderAgent().learn_from_build("summarize a PDF", {}, ["step"], ["llm"])
    assert isinstance(out, str)
    assert out != ""
