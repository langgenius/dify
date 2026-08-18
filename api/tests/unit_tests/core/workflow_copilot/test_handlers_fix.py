"""Tests for the run-fix + checklist handlers (Tasks 6-7).

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/handlers_fix_test.go
— both the run-fix cases and the checklist-fix flow / ``fix_registry()``
cases (``## ---- checklist-fix flow ----``).
"""

from datetime import datetime

from core.workflow_copilot.handlers_fix import (
    fix_registry,
    handle_apply,
    handle_await_approval,
    handle_await_decision,
    handle_await_testdata,
    handle_await_verify,
    handle_diagnose,
    handle_propose,
    handle_publish,
    handle_verify,
)
from core.workflow_copilot.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    EntryMode,
    FixContext,
    Run,
    Session,
    Turn,
)
from core.workflow_copilot.runner import Env, Runner
from core.workflow_copilot.state import PcState, canvas_read_only
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository, StubAgent

# ---- shared fixtures / helpers -------------------------------------------


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _session(**overrides) -> Session:
    fields: dict = {
        "app_id": "app",
        "tenant_id": "t",
        "owner_account_id": "u",
        "entry_mode": EntryMode.FIX,
        "current_state": PcState.FIX_DIAGNOSE,
    }
    fields.update(overrides)
    return Session(**fields)


def _new_env() -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=FakeDifyPort(),
        agent=StubAgent(),
        repo=repo,
        now=lambda: datetime.min,
    )
    return env, repo


def _run_fix_registry() -> dict[PcState, object]:
    """The run-fix subset of Go's ``FixRegistry`` (checklist entries are Task 7)."""
    return {
        PcState.FIX_DIAGNOSE: handle_diagnose,
        PcState.FIX_PROPOSE: handle_propose,
        PcState.FIX_AWAIT_APPROVAL: handle_await_approval,
        PcState.FIX_APPLY: handle_apply,
        PcState.FIX_AWAIT_VERIFY: handle_await_verify,
        PcState.FIX_AWAIT_TESTDATA: handle_await_testdata,
        PcState.FIX_VERIFY: handle_verify,
        PcState.FIX_AWAIT_DECISION: handle_await_decision,
        PcState.FIX_PUBLISH: handle_publish,
    }


def _seed_diagnose_session(repo: InMemoryRepository) -> Session:
    s = _session()
    repo.create_session(s, FixContext(failed_run_id="TR-1"), [ConversationItem(kind="run-context", seq=0)])
    repo.save_run(s.id, Run(id="TR-1", kind="original-failed", status="failed", immutable=True))
    return s


def _drive_to_await_verify(env: Env, repo: InMemoryRepository) -> tuple[Runner, Session]:
    s = _seed_diagnose_session(repo)
    runner = Runner(env, _run_fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    return runner, out


def _drive_to_await_decision(env: Env, repo: InMemoryRepository) -> tuple[Runner, Session]:
    runner, s = _drive_to_await_verify(env, repo)
    turn = Turn(action=Action(kind="run_verify", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version), actor=_actor()
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION
    return runner, out


# ---- diagnose -> propose -----------------------------------------------


def test_diagnose_then_propose_high_risk_stops_at_await_approval():
    env, repo = _new_env()
    env.agent.risk_level = "high"
    s = _seed_diagnose_session(repo)

    runner = Runner(env, _run_fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert not canvas_read_only(out.current_state), "await states leave the canvas editable"


def test_diagnose_then_propose_low_risk_creates_checkpoint_and_stages_repair():
    env, repo = _new_env()
    s = _seed_diagnose_session(repo)

    runner = Runner(env, _run_fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    # low-risk stub => auto-advance diagnose -> propose -> apply -> await_verify
    assert out.current_state == PcState.FIX_AWAIT_VERIFY

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "output"
    assert fc.staged_repair
    assert fc.checkpoint_id, "a repair checkpoint must be created before mutation"


def test_apply_writes_graph_locks_during_work_unlocks_at_await_verify():
    env, repo = _new_env()
    fake = env.dify
    s = _seed_diagnose_session(repo)

    runner = Runner(env, _run_fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    assert not canvas_read_only(out.current_state), "await_verify is editable"
    assert fake.applied, "apply must call the adapter with the staged repair"

    _, fc = repo.get_session(s.id)
    assert fc.change_set is not None
    assert "output" in fc.change_set.changed_nodes


# ---- await_approval ------------------------------------------------------


def test_await_approval_stray_action_no_auto_apply_approve_advances():
    env, repo = _new_env()
    env.agent.risk_level = "high"
    s = _seed_diagnose_session(repo)

    runner = Runner(env, _run_fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_APPROVAL

    # (a) a stray/unknown action must NOT auto-apply the high-risk repair.
    turn = Turn(action=Action(kind="undo", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_APPROVAL, (
        "an unknown/stray action must not auto-apply a high-risk repair"
    )

    # (b) an explicit approval advances past the gate.
    turn = Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY


# ---- verify ---------------------------------------------------------------


def test_verify_mints_new_immutable_run_original_untouched():
    env, repo = _new_env()
    runner, s = _drive_to_await_verify(env, repo)

    # run_verify (no inputs) -> await_testdata
    turn = Turn(action=Action(kind="run_verify", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA

    # provide mock data -> verify (working) -> await_decision
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version), actor=_actor()
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION

    _, fc = repo.get_session(s.id)
    assert fc.verify_run_id
    assert fc.verify_run_id != fc.failed_run_id, "verify must mint a NEW run id"

    orig = repo.get_run(fc.failed_run_id)
    assert orig.status == "failed", "original failed run is never mutated"
    verify = repo.get_run(fc.verify_run_id)
    assert verify.kind == "verify"
    assert verify.immutable


def test_verify_threads_test_inputs_to_run_draft():
    """Regression guard: handle_verify must resolve fc.test_input_ref via
    repo.get_test_input and pass the REAL saved inputs to dify.run_draft, not
    an empty stub."""
    env, repo = _new_env()
    fake = env.dify
    runner, s = _drive_to_await_verify(env, repo)

    turn = Turn(action=Action(kind="run_verify", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA

    want_inputs = {"report_pdf": "q3.pdf"}
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"inputs": want_inputs}, base_version=out.version),
        actor=_actor(),
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION

    _, fc = repo.get_session(s.id)
    assert fc.test_input_ref

    saved = repo.get_test_input(fc.test_input_ref)
    assert saved.inputs == want_inputs

    assert fake.run_draft_inputs, "run_draft must receive real inputs, not an empty stub"
    assert fake.run_draft_inputs == want_inputs


def test_verify_fail_freezes_run_allows_re_fix():
    env, repo = _new_env()
    env.dify.verify_pass = False
    runner, s = _drive_to_await_verify(env, repo)

    turn = Turn(action=Action(kind="run_verify", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version), actor=_actor()
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION

    _, fc = repo.get_session(s.id)
    verify = repo.get_run(fc.verify_run_id)
    assert verify.status == "failed"
    assert verify.immutable


# ---- await_decision --------------------------------------------------------


def test_decision_publish_reaches_success():
    env, repo = _new_env()
    fake = env.dify
    runner, s = _drive_to_await_decision(env, repo)

    turn = Turn(action=Action(kind="publish", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS
    assert fake.published


def test_decision_undo_is_append_only():
    env, repo = _new_env()
    runner, s = _drive_to_await_decision(env, repo)
    items_before = len(repo.list_conversation(s.id))
    version_before = s.version

    turn = Turn(action=Action(kind="undo", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS

    # history is append-only: undo added exactly one commit (version +1) and
    # one conversation item, never removing prior history.
    assert out.version == version_before + 1
    assert len(repo.list_conversation(s.id)) == items_before + 1


def test_decision_re_fix_loops_back_to_diagnose_and_clears_repair_state():
    env, repo = _new_env()
    runner, s = _drive_to_await_decision(env, repo)

    turn = Turn(action=Action(kind="re_fix", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)

    # re_fix auto-advances straight back through diagnose -> propose -> apply
    # -> await_verify (low-risk stub), same as the very first drive.
    assert out.current_state == PcState.FIX_AWAIT_VERIFY

    _, fc = repo.get_session(s.id)
    assert fc.verify_run_id == ""
    assert fc.test_input_ref == ""


# ---- checklist-fix flow ----------------------------------------------------


def _seed_checklist_session(repo: InMemoryRepository, errors: list[ChecklistError]) -> Session:
    s = _session(entry_mode=EntryMode.FIX_CHECKLIST, current_state=PcState.CHECKLIST_DIAGNOSE)
    repo.create_session(
        s,
        FixContext(source="checklist", checklist_errors=errors),
        [ConversationItem(kind="run-context", seq=0)],
    )
    return s


def _drive_checklist_to_await_recheck(env: Env, repo: InMemoryRepository) -> tuple[Runner, Session]:
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]
    s = _seed_checklist_session(repo, errors)

    runner = Runner(env, fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    # low-risk stub => auto-advance checklist.diagnose -> checklist.propose -> fix.apply -> checklist.await_recheck
    assert out.current_state == PcState.CHECKLIST_AWAIT_RECHECK
    return runner, out


def test_checklist_fix_diagnose_to_apply_reaches_await_recheck():
    env, repo = _new_env()
    fake = env.dify
    runner, s = _drive_checklist_to_await_recheck(env, repo)
    assert runner is not None

    assert fake.applied, "checklist apply must call the adapter with the staged repair"

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "n1"
    assert fc.staged_repair

    items = repo.list_conversation(s.id)
    found = False
    for item in items:
        if item.kind == "diagnosis":
            assert item.payload["source"] == "checklist"
            found = True
    assert found, "diagnosis item must be recorded with source=checklist"


def test_checklist_fix_recheck_passed_reaches_success_via_publish():
    env, repo = _new_env()
    fake = env.dify
    runner, s = _drive_checklist_to_await_recheck(env, repo)

    turn = Turn(action=Action(kind="recheck", payload={"passed": True}, base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION

    turn = Turn(action=Action(kind="publish", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS
    assert fake.published


def test_checklist_fix_recheck_failed_loops_back_to_diagnose():
    env, repo = _new_env()
    runner, s = _drive_checklist_to_await_recheck(env, repo)

    remaining = [{"node_id": "n2", "node_type": "llm", "title": "LLM", "messages": ["still broken"]}]
    turn = Turn(
        action=Action(kind="recheck", payload={"passed": False, "remaining": remaining}, base_version=s.version),
        actor=_actor(),
    )
    out = runner.advance(s.id, turn)
    # low-risk stub => auto-advances checklist.diagnose -> checklist.propose
    # -> fix.apply -> checklist.await_recheck again
    assert out.current_state == PcState.CHECKLIST_AWAIT_RECHECK

    _, fc = repo.get_session(s.id)
    assert len(fc.checklist_errors) == 1
    assert fc.checklist_errors[0].node_id == "n2"
    assert fc.checklist_errors[0].messages == ["still broken"]


def test_checklist_fix_await_recheck_undo_reaches_success():
    env, repo = _new_env()
    runner, s = _drive_checklist_to_await_recheck(env, repo)

    turn = Turn(action=Action(kind="undo", base_version=s.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS


# ---- fix_registry -----------------------------------------------------------


def test_fix_registry_has_exactly_twelve_states():
    registry = fix_registry()

    assert set(registry.keys()) == {
        PcState.FIX_DIAGNOSE,
        PcState.FIX_PROPOSE,
        PcState.FIX_AWAIT_APPROVAL,
        PcState.FIX_APPLY,
        PcState.FIX_AWAIT_VERIFY,
        PcState.FIX_AWAIT_TESTDATA,
        PcState.FIX_VERIFY,
        PcState.FIX_AWAIT_DECISION,
        PcState.FIX_PUBLISH,
        PcState.CHECKLIST_DIAGNOSE,
        PcState.CHECKLIST_PROPOSE,
        PcState.CHECKLIST_AWAIT_RECHECK,
    }
    # checklist.propose reuses the run-fix propose handler, as Go does.
    assert registry[PcState.CHECKLIST_PROPOSE] is handle_propose
