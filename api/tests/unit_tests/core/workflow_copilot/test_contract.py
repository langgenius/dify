"""Contract enums for the Build/Edit slice.

Spec: docs/superpowers/specs/2026-08-21-workflow-copilot-full-flow-contract-design.md, §2/§6/§7.
"""

from core.workflow_copilot.contract import ActionKind, CanvasEvent, Phase, RunStatus
from core.workflow_copilot.models import EntryMode
from core.workflow_copilot.state import PcState


def test_enums_match_spec():
    assert [p.value for p in Phase] == [
        "understand",
        "clarify",
        "resources",
        "plan",
        "modify",
        "test",
        "review",
        "publish",
        "complete",
    ]
    assert [r.value for r in RunStatus] == [
        "thinking",
        "executing",
        "waiting_input",
        "waiting_confirmation",
        "paused",
        "failed",
        "complete",
    ]
    assert set(ActionKind) == {ActionKind.PRIMARY, ActionKind.SECONDARY, ActionKind.DESTRUCTIVE, ActionKind.AUTOMATIC}
    assert len(list(CanvasEvent)) == 22  # authoritative count = the mock's CopilotCanvasEvent union (spec §6)
    assert {EntryMode.BUILD, EntryMode.EDIT} <= set(EntryMode)
    assert PcState.BUILD_GOAL_ANALYSIS.value == "build.goal_analysis"
    assert PcState.EDIT_IMPACT_ANALYSIS.value == "edit.impact_analysis"
