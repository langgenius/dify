"""Port of the struct-shape assertions implicit in models.go's callers.

Go has no separate models_test.go; the "spec" for field shapes/defaults is
how dify-enterprise/server/pkg/enterprise/biz/copilot/*_test.go construct
these structs (see e.g. handlers_fix_test.go, runner_test.go): almost every
struct literal in that suite sets only a handful of fields and relies on
Go's implicit zero-initialization for the rest (``&Session{AppID: "app",
TenantID: "t", OwnerAccountID: "u", EntryMode: EntryModeFix, CurrentState:
FixDiagnose}``, ``&CopilotContext{}``, ``&CopilotContext{FailedRunID: "TR-1"}``).
These tests port that same terse-construction ergonomics and assert the
Python defaults match the Go zero values field-for-field.
"""

from datetime import datetime

from core.workflow_copilot.models import (
    Action,
    Actor,
    ChecklistError,
    Checkpoint,
    ConversationItem,
    CopilotContext,
    EntryMode,
    NodeOutput,
    Run,
    Session,
    Snapshot,
    TestInput,
    Turn,
)
from core.workflow_copilot.state import PcState


def test_entry_mode_values_are_verbatim_go_strings():
    assert EntryMode.FIX == "fix"
    assert EntryMode.FIX_CHECKLIST == "fix_checklist"


def test_checklist_error_defaults_and_construction():
    e = ChecklistError()
    assert e.node_id == ""
    assert e.node_type == ""
    assert e.title == ""
    assert e.messages == []
    assert e.unconnected is False
    assert e.plugin_missing is False

    # Mirrors placeholder_agent_test.go: ChecklistError{NodeID: "n1", Unconnected: true}
    e2 = ChecklistError(node_id="n1", unconnected=True)
    assert e2.node_id == "n1"
    assert e2.unconnected is True
    assert e2.node_type == ""
    assert e2.messages == []

    # Mirrors handlers_fix_test.go: ChecklistError{NodeID: "n1", NodeType: "code",
    # Title: "Code", Messages: []string{"missing required field 'metrics'"}}
    e3 = ChecklistError(node_id="n1", node_type="code", title="Code", messages=["missing required field 'metrics'"])
    assert e3.messages == ["missing required field 'metrics'"]


def test_checklist_error_default_factory_not_shared_between_instances():
    e1 = ChecklistError()
    e2 = ChecklistError()
    e1.messages.append("boom")
    assert e2.messages == []


def test_session_construction_at_version_1():
    now = datetime(2026, 8, 18, 0, 0, 0)
    # Mirrors handlers_fix_test.go: &Session{AppID: "app", TenantID: "t",
    # OwnerAccountID: "u", EntryMode: EntryModeFix, CurrentState: FixDiagnose}
    # (ID/Version/CreatedAt/UpdatedAt all omitted, relying on Go zero values).
    s = Session(
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    assert s.id == ""
    assert s.version == 0
    assert s.created_at == datetime.min
    assert s.updated_at == datetime.min

    s.version = 1
    assert s.version == 1

    s2 = Session(
        id="sess-1",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.FIX_CHECKLIST,
        current_state=PcState.CHECKLIST_DIAGNOSE,
        version=1,
        created_at=now,
        updated_at=now,
    )
    assert s2.version == 1
    assert s2.created_at == now


def test_node_output_defaults():
    o = NodeOutput()
    assert o.error == ""
    assert o.inputs == {}
    assert o.outputs == {}

    # Mirrors fakes_test.go: NodeOutput{NodeID: "output", Status: "failed", Error: "missing metrics"}
    o2 = NodeOutput(node_id="output", status="failed", error="missing metrics")
    assert o2.title == ""
    assert o2.inputs == {}


def test_run_immutable_default_and_construction():
    r = Run()
    assert r.immutable is False
    assert r.per_node == []
    assert r.tokens == 0
    assert r.elapsed_ms == 0

    # Mirrors handlers_fix_test.go: &Run{ID: "TR-1", Kind: "original-failed",
    # Status: "failed", Immutable: true}
    r2 = Run(id="TR-1", kind="original-failed", status="failed", immutable=True)
    assert r2.immutable is True
    assert r2.dify_run_id == ""
    assert r2.per_node == []


def test_run_per_node_default_factory_not_shared_between_instances():
    r1 = Run()
    r2 = Run()
    r1.per_node.append(NodeOutput(node_id="n1"))
    assert r2.per_node == []


def test_snapshot_defaults():
    snap = Snapshot(session_id="sess-1", hash="h1")
    assert snap.id == ""
    assert snap.graph == {}


def test_checkpoint_requires_state_but_defaults_ids():
    cp = Checkpoint(state=PcState.FIX_APPLY)
    assert cp.id == ""
    assert cp.session_id == ""
    assert cp.snapshot_id == ""
    assert cp.state == PcState.FIX_APPLY


def test_test_input_defaults():
    ti = TestInput(session_id="sess-1", source="mock")
    assert ti.id == ""
    assert ti.inputs == {}
    assert ti.start_schema_hash == ""


def test_conversation_item_defaults():
    item = ConversationItem(kind="run-context", seq=0)
    assert item.payload == {}
    assert item.at_version == 0


def test_fix_context_round_trip_defaults_empty():
    # Mirrors runner_test.go: repo.CreateSession(..., &CopilotContext{}, nil)
    fc = CopilotContext()
    assert fc.failed_run_id == ""
    assert fc.diagnosis is None
    assert fc.staged_repair == []
    assert fc.risk is None
    assert fc.change_set is None
    assert fc.checkpoint_id == ""
    assert fc.verify_run_id == ""
    assert fc.test_input_ref == ""
    assert fc.last_snapshot_hash == ""
    assert fc.next_seq == 0
    assert fc.source == ""
    assert fc.checklist_errors == []


def test_fix_context_partial_construction():
    # Mirrors handlers_fix_test.go: &CopilotContext{FailedRunID: "TR-1"}
    fc = CopilotContext(failed_run_id="TR-1")
    assert fc.failed_run_id == "TR-1"
    assert fc.source == ""

    # Mirrors handlers_fix_test.go: &CopilotContext{Source: "checklist", ChecklistErrors: errs}
    errs = [ChecklistError(node_id="n1", unconnected=True)]
    fc2 = CopilotContext(source="checklist", checklist_errors=errs)
    assert fc2.source == "checklist"
    assert fc2.checklist_errors == errs
    assert fc2.failed_run_id == ""


def test_action_defaults_payload_and_verbatim_kind():
    # Mirrors handlers_fix_test.go: &Action{Kind: "request_fix", BaseVersion: 1}
    a = Action(kind="request_fix", base_version=1)
    assert a.kind == "request_fix"
    assert a.base_version == 1
    assert a.payload == {}


def test_actor_has_no_forward_auth():
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")
    assert actor.account_id == "acc-1"
    assert actor.tenant_id == "tenant-1"
    assert not hasattr(actor, "auth")
    assert not hasattr(actor, "bearer")


def test_turn_action_is_optional_actor_is_not():
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")

    turn_no_action = Turn(actor=actor)
    assert turn_no_action.action is None
    assert turn_no_action.actor is actor

    action = Action(kind="request_fix", base_version=1)
    turn_with_action = Turn(action=action, actor=actor)
    assert turn_with_action.action is action

    assert not hasattr(turn_with_action, "auth")
