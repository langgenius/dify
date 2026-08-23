"""Contract enums for the Build/Edit slice.

Spec: docs/superpowers/specs/2026-08-21-workflow-copilot-full-flow-contract-design.md, §2/§6/§7.
"""

import json
from dataclasses import asdict
from pathlib import Path

from core.workflow_copilot.contract import (
    ActionKind,
    AssistantTurnItem,
    CanvasEvent,
    CardKind,
    ChangeSetCard,
    FormCard,
    FormField,
    Phase,
    PlanCard,
    PublishCard,
    RequirementsPayload,
    ResourceOption,
    ResourceSelectCard,
    RunStatus,
    SummaryCard,
    TestResultCard,
    TestStat,
    Trace,
    TraceStep,
)
from core.workflow_copilot.models import EntryMode
from core.workflow_copilot.state import PcState
from services.workflow_copilot.service import SessionView, _run_status
from services.workflow_copilot.wiring import session_view_to_dict


def test_recovery_class_members():
    from core.workflow_copilot.contract import RecoveryClass

    assert RecoveryClass.UNCHANGED == "unchanged"
    assert RecoveryClass.CONFIG_ONLY == "config_only"
    assert RecoveryClass.STRUCTURAL_COMPATIBLE == "structural_compatible"
    assert RecoveryClass.STRUCTURAL_INVALIDATING == "structural_invalidating"
    assert [c.value for c in RecoveryClass] == [
        "unchanged", "config_only", "structural_compatible", "structural_invalidating",
    ]


def test_recovery_ref_fields():
    from core.workflow_copilot.contract import RecoveryRef

    ref = RecoveryRef(recovery_class="config_only", can_continue=True, can_restart=True, message="m")
    assert ref.recovery_class == "config_only"
    assert ref.can_continue is True
    assert ref.can_restart is True
    assert ref.message == "m"


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


def test_run_status_terminal_states():
    """Regression for the reviewer-found defect: PcState.BUILD_COMPLETE and
    PcState.EDIT_PUBLISH are terminal (spec §7.1/§7.2, run_status: complete)
    but are absent from both _WORKING and _WAITING and aren't SUCCESS/FAILED
    -- _run_status must special-case is_terminal() before the waiting/working
    checks, or these fall through to EXECUTING."""
    assert _run_status(PcState.SUCCESS) == RunStatus.COMPLETE
    assert _run_status(PcState.FAILED) == RunStatus.FAILED
    assert _run_status(PcState.BUILD_COMPLETE) == RunStatus.COMPLETE
    assert _run_status(PcState.EDIT_PUBLISH) == RunStatus.COMPLETE
    assert _run_status(PcState.FIX_DIAGNOSE) == RunStatus.EXECUTING  # working
    assert _run_status(PcState.FIX_AWAIT_DECISION) == RunStatus.WAITING_INPUT  # waiting


def test_card_shapes_round_trip():
    """Each card's asdict() is exactly its wire payload (no ``kind`` key --
    ``kind`` is a ClassVar discriminant), and to_item() wraps it into the
    shipped ConversationItem envelope. One representative assertion per
    card family (spec §4.3), plus one typed submit payload (spec §5)."""

    # change_set -- the brief's canonical example.
    c = ChangeSetCard(count=2, changes=["a", "b"], scope="configuration", full_diff_open=False)
    assert c.kind == CardKind.CHANGE_SET
    assert "kind" not in asdict(c)
    assert asdict(c) == {"count": 2, "changes": ["a", "b"], "scope": "configuration", "full_diff_open": False}
    item = c.to_item(seq=5, at_version=3)
    assert item.kind == "change_set"
    assert item.seq == 5
    assert item.at_version == 3
    assert item.payload == {"count": 2, "changes": ["a", "b"], "scope": "configuration", "full_diff_open": False}

    # plan
    plan = PlanCard(title="Build plan", version_tag="v1", items=["Add start node", "Add LLM node"])
    assert plan.kind == CardKind.PLAN
    assert "kind" not in asdict(plan)
    plan_item = plan.to_item(seq=1, at_version=1)
    assert plan_item.kind == "plan"
    assert plan_item.payload == {
        "title": "Build plan",
        "version_tag": "v1",
        "items": ["Add start node", "Add LLM node"],
        "subtitle": None,
    }

    # form -- with a FormField.
    form = FormCard(
        variant="build_requirements",
        fields=[FormField(key="audience", label="Audience", type="text")],
        values={"audience": "execs"},
    )
    assert form.kind == CardKind.FORM
    assert "kind" not in asdict(form)
    form_item = form.to_item(seq=2, at_version=1)
    assert form_item.payload["fields"] == [{"key": "audience", "label": "Audience", "type": "text", "options": []}]
    assert form_item.payload["values"] == {"audience": "execs"}
    assert form_item.payload["frozen"] is False

    # resource_select -- readiness must survive asdict.
    rs = ResourceSelectCard(
        recommended=[
            ResourceOption(id="r1", label="Sales KB", meta="42 docs", kind="knowledge", readiness="ready"),
        ],
    )
    assert rs.kind == CardKind.RESOURCE_SELECT
    assert "kind" not in asdict(rs)
    rs_item = rs.to_item(seq=3, at_version=1)
    assert rs_item.payload["recommended"][0]["readiness"] == "ready"

    # test_result -- with a TestStat.
    tr = TestResultCard(
        title="Validation passed",
        subtitle="All checks green",
        tone="success",
        stats=[TestStat(value="3/3", label="Runs")],
        run_ids=["run-1"],
    )
    assert tr.kind == CardKind.TEST_RESULT
    assert "kind" not in asdict(tr)
    tr_item = tr.to_item(seq=4, at_version=2)
    assert tr_item.payload["stats"] == [{"value": "3/3", "label": "Runs"}]

    # summary
    summary = SummaryCard(variant="review", title="Pre-publish checklist", items=["4 nodes read", "3 var mappings"])
    assert summary.kind == CardKind.SUMMARY
    assert "kind" not in asdict(summary)
    summary_item = summary.to_item(seq=6, at_version=3)
    assert summary_item.payload == {
        "variant": "review",
        "title": "Pre-publish checklist",
        "items": ["4 nodes read", "3 var mappings"],
        "rows": [],
    }

    # publish
    pub = PublishCard(version="v1.0")
    assert pub.kind == CardKind.PUBLISH
    assert "kind" not in asdict(pub)
    pub_item = pub.to_item(seq=7, at_version=4)
    assert pub_item.payload == {"version": "v1.0", "badge": "live"}

    # assistant_turn -- trace.steps[*] carries state/tone/canvas_event.
    turn = AssistantTurnItem(
        turn_id="t1",
        stage_id="build.goal_analysis",
        trace=Trace(
            status="running",
            steps=[TraceStep(id="s1", label="Reading goal", state="active", tone="neutral", canvas_event=None)],
        ),
        reply_text="Looking at your goal...",
        cards=["plan"],
    )
    assert turn.kind == CardKind.ASSISTANT_TURN
    assert "kind" not in asdict(turn)
    turn_item = turn.to_item(seq=8, at_version=4)
    assert turn_item.kind == "assistant_turn"
    step_payload = turn_item.payload["trace"]["steps"][0]
    assert step_payload["state"] == "active"
    assert step_payload["tone"] == "neutral"
    assert step_payload["canvas_event"] is None

    # typed submit payload -- not a card: no kind, no to_item.
    req = RequirementsPayload(
        report_types="quarterly",
        audience="execs",
        currency="USD",
        metrics="revenue,churn",
        output="PDF summary",
        prefer_audited=True,
    )
    assert not hasattr(req, "kind")
    assert not hasattr(req, "to_item")
    assert asdict(req) == {
        "report_types": "quarterly",
        "audience": "execs",
        "currency": "USD",
        "metrics": "revenue,churn",
        "output": "PDF summary",
        "prefer_audited": True,
    }


def test_schema_in_lockstep():
    """The checked-in JSON Schema + TypeScript are DERIVED from contract.py
    (+ EntryMode/ConversationItem/SessionView) via contract_gen.generate().
    This byte-compares a fresh generation against the checked-in files so
    drift/hand-edits fail CI instead of silently diverging from the FE."""
    from core.workflow_copilot import contract_gen

    schema, ts = contract_gen.generate()
    root = next(p for p in Path(__file__).parents if (p / "web").is_dir() and (p / "api").is_dir())
    checked_json = (root / "api/core/workflow_copilot/contract_schema.json").read_text()
    checked_ts = (root / "web/app/components/workflow-copilot/contract/types.ts").read_text()
    regen_hint = "run: uv run --directory api python -m core.workflow_copilot.contract_gen"
    assert json.dumps(schema, indent=2, ensure_ascii=False) + "\n" == checked_json, regen_hint
    assert ts == checked_ts, regen_hint


def test_sample_session_view_validates():
    """The generated schema is itself a valid JSON Schema and accepts a
    real (minimal) SessionView instance -- proves $defs/$ref resolution
    round-trips, not just that generate() runs without raising."""
    import jsonschema

    from core.workflow_copilot import contract_gen

    schema, _ts = contract_gen.generate()
    jsonschema.Draft202012Validator.check_schema(schema)

    sample = {
        "session_id": "s1",
        "app_id": "a1",
        "version": 1,
        "state": "fix.await_verify",
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation": [],
        "entry_mode": "fix",
        "phase": "test",
        "actions": [],
        "checkpoint": None,
    }
    jsonschema.validate(sample, {**schema, "$ref": "#/$defs/SessionView"})
