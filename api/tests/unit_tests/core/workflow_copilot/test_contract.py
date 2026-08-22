"""Contract enums for the Build/Edit slice.

Spec: docs/superpowers/specs/2026-08-21-workflow-copilot-full-flow-contract-design.md, §2/§6/§7.
"""

from core.workflow_copilot.contract import ActionKind, CanvasEvent, Phase, RunStatus
from core.workflow_copilot.models import EntryMode
from core.workflow_copilot.state import PcState
from services.workflow_copilot.service import SessionView
from services.workflow_copilot.wiring import session_view_to_dict


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


def test_sessionview_has_new_fields():
    """SessionView (spec §1) carries entry_mode/phase/actions/checkpoint,
    and dataclasses.asdict serializes them to snake_case wire keys."""
    fix_session_view = SessionView(
        session_id="s1",
        app_id="a1",
        version=1,
        state="fix.diagnose",
        canvas_read_only=True,
        run_status=RunStatus.EXECUTING,
        interrupted=False,
        conversation=[],
    )
    d = session_view_to_dict(fix_session_view)
    assert d["entry_mode"] == "fix"
    assert d["phase"] in {p.value for p in Phase}
    assert isinstance(d["actions"], list)
    assert "checkpoint" in d
