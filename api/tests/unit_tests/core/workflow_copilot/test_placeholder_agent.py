"""Port of placeholder_agent_test.go + the placeholder-agent slice of seam_test.go.

Mirrors dify-enterprise/server/pkg/enterprise/biz/copilot/placeholder_agent_test.go:
``TestPlaceholderAgent_ProposeRepair_ReplacesCulpritCode``,
``TestPlaceholderAgent_DiagnoseChecklist_PicksFirstErrorWithMessages``,
``TestPlaceholderAgent_DiagnoseChecklist_NoMessagesAnywhere_ReturnsGenericCause``.

The full-flow ``TestSeam_AnyConformingAgent_DrivesFlowToTerminal`` (running
``PlaceholderAgent`` through the ``Runner`` end-to-end) belongs to Task 9's
``test_fix_flow.py`` acceptance test; here we only assert the typing seam
(``PlaceholderAgent`` structurally satisfies ``CopilotAgent``), the same
narrower scope ``test_ports.py``'s ``_StubAgent`` seam check covers for a
throwaway conformer.
"""

from core.workflow_copilot.models import ChecklistError, Graph, NodeOutput, Run
from core.workflow_copilot.placeholder_agent import FIXED_CODE, PlaceholderAgent
from core.workflow_copilot.ports import CopilotAgent


def test_placeholder_agent_satisfies_copilot_agent_protocol():
    assert isinstance(PlaceholderAgent(), CopilotAgent)


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
