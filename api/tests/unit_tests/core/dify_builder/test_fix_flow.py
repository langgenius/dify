"""Full Fix-flow engine acceptance test (Task 9).

Wires the real engine — ``Runner`` + ``fix_registry()`` + ``PlaceholderAgent``
+ the in-memory fakes — and drives one session through the complete happy
path end to end: ``request_fix`` (auto diagnose -> propose -> apply) ->
``run_verify`` -> ``provide_testdata`` (mock) -> verify (green) ->
``publish`` -> ``success``. This is the P1 deliverable: proof the ported
engine actually holds together, not just its individual pieces.

Mirrors the Go full-flow intent exercised piecemeal across
``handlers_fix_test.go`` and ``seam_test.go``
(``TestSeam_AnyConformingAgent_DrivesFlowToTerminal``), assembled here into
one acceptance run plus a checklist-entry smoke test.
"""

from datetime import datetime

import pytest

from core.dify_builder.errors import ConflictError
from core.dify_builder.handlers_fix import fix_registry
from core.dify_builder.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
    Turn,
)
from core.dify_builder.placeholder_agent import FIXED_CODE, PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState, canvas_read_only
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _new_env() -> tuple[Env, InMemoryRepository, FakeDifyPort]:
    repo = InMemoryRepository()
    dify = FakeDifyPort()
    env = Env(
        dify=dify,
        agent=PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
    )
    return env, repo, dify


def _fix_session(**overrides) -> Session:
    fields: dict = {
        "app_id": "app",
        "tenant_id": "tenant-1",
        "owner_account_id": "acc-1",
        "entry_mode": EntryMode.FIX,
        "current_state": PcState.FIX_DIAGNOSE,
    }
    fields.update(overrides)
    return Session(**fields)


def _seed_fix_session(repo: InMemoryRepository) -> Session:
    """Seed a session at fix.diagnose with a run-context item and a
    DifyBuilderContext pointing at a pre-existing failed run. The Fix flow diagnoses
    from this already-ingested "red" run; it never re-runs it."""
    s = _fix_session()
    repo.create_session(
        s,
        DifyBuilderContext(failed_run_id="TR-1"),
        [ConversationItem(kind="run-context", seq=0, payload={"failed_run_id": "TR-1"})],
    )
    repo.save_run(s.id, Run(id="TR-1", kind="original-failed", status="failed", immutable=True))
    return s


# ---- full happy-path acceptance --------------------------------------------


def test_full_fix_flow_request_fix_to_publish_success():
    env, repo, dify = _new_env()
    s = _seed_fix_session(repo)

    runner = Runner(env, fix_registry())

    # 1) request_fix: auto-advances diagnose -> propose -> apply -> await_verify
    #    (PlaceholderAgent's canned repair is low-risk => no approval gate).
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    assert not canvas_read_only(out.current_state), "await_verify must leave the canvas editable"

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "output"  # FakeDifyPort.node_outputs' sole failed node
    assert fc.staged_repair
    assert fc.risk is not None
    assert fc.risk.level == "low"
    assert fc.checkpoint_id, "diagnose must create a checkpoint before any mutation"

    # a checkpoint was actually persisted and restorable.
    cp, snap = repo.get_checkpoint(fc.checkpoint_id)
    assert cp.session_id == s.id
    assert cp.state == PcState.FIX_DIAGNOSE
    assert snap.id == cp.snapshot_id

    # canvas-lock: every state observed so far on the working leg was locked
    # (implicitly, by never stopping the loop there); the state we landed on
    # (an await state) is editable.
    assert canvas_read_only(PcState.FIX_DIAGNOSE)
    assert canvas_read_only(PcState.FIX_PROPOSE)
    assert canvas_read_only(PcState.FIX_APPLY)

    # apply_repair received the placeholder's set_node_config intent.
    assert dify.applied
    assert dify.applied[0].op == "set_node_config"
    assert dify.applied[0].args["path"] == "code"
    assert dify.applied[0].args["value"] == FIXED_CODE

    # the original failed run is untouched by diagnose/propose/apply.
    original = repo.get_run("TR-1")
    assert original.status == "failed"
    assert original.immutable

    # 2) run_verify -> fix.await_testdata (locked-work-free transition; a
    #    waiting state feeding a waiting state, no auto-advance happens here
    #    because there's no test_input_ref staged yet).
    turn = Turn(action=Action(kind="run_verify", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA
    assert canvas_read_only(out.current_state) is False, "await_testdata must leave the canvas editable"

    # 3) provide_testdata (mock) -> fix.verify (working, green) -> await_decision.
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version),
        actor=_actor(),
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION
    assert not canvas_read_only(out.current_state), "await_decision must leave the canvas editable"
    assert canvas_read_only(PcState.FIX_VERIFY), "fix.verify (the working step in between) must be locked"

    _, fc = repo.get_session(s.id)
    assert fc.test_input_ref, "mock mode must stage a TestInput"
    assert dify.run_draft_inputs == {"query": "mock"}, "PlaceholderAgent.generate_mock_inputs' canned inputs"

    # the re-expressed card vocabulary: apply's change-set and verify's
    # result must be emitted as "change_set"/"test_result" typed-card kinds
    # (the card vocabulary), not the old "change-set"/"verify-result" strings.
    conv_kinds = {item.kind for item in repo.list_conversation(s.id)}
    assert "change_set" in conv_kinds
    assert "test_result" in conv_kinds
    assert "change-set" not in conv_kinds
    assert "verify-result" not in conv_kinds

    # run-immutability: verify minted a brand NEW run id, distinct from the
    # original failed run, and it is marked immutable.
    assert fc.verify_run_id
    assert fc.verify_run_id != "TR-1"
    original_again = repo.get_run("TR-1")
    assert original_again.status == "failed", "original failed run must remain untouched by verify"

    verify_run = repo.get_run(fc.verify_run_id)
    assert verify_run.id == fc.verify_run_id, "fc.verify_run_id must match the persisted verify run"
    assert verify_run.kind == "verify"
    assert verify_run.immutable
    assert verify_run.status == "succeeded", "verify_pass=True (default) => the repair verifies GREEN"

    # 4) publish -> fix.publish (working) -> success.
    turn = Turn(action=Action(kind="publish", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS
    assert canvas_read_only(PcState.FIX_PUBLISH), "fix.publish (the working step in between) must be locked"

    assert dify.published is True

    stored, _ = repo.get_session(s.id)
    assert stored.current_state == PcState.SUCCESS
    assert stored.version == out.version


def test_full_fix_flow_stale_base_version_raises_conflict():
    """CAS: each mutating action must carry the session's current version;
    a stale one is rejected and nothing is applied."""
    env, repo, _dify = _new_env()
    s = _seed_fix_session(repo)
    runner = Runner(env, fix_registry())

    # correct base_version (1) advances all the way to fix.await_verify.
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    version_after_first_turn = out.version

    # a stale base_version on the next action raises ConflictError and
    # applies nothing.
    stale_turn = Turn(action=Action(kind="run_verify", base_version=1), actor=_actor())
    with pytest.raises(ConflictError):
        runner.advance(s.id, stale_turn)

    stored, _ = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY
    assert stored.version == version_after_first_turn, "a lost CAS race must leave the session untouched"

    # the correct (current) base_version succeeds.
    turn = Turn(action=Action(kind="run_verify", base_version=version_after_first_turn), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA


# ---- checklist-entry smoke -------------------------------------------------


def _seed_checklist_session(repo: InMemoryRepository, errors: list[ChecklistError]) -> Session:
    s = _fix_session(entry_mode=EntryMode.FIX_CHECKLIST, current_state=PcState.CHECKLIST_DIAGNOSE)
    repo.create_session(
        s,
        DifyBuilderContext(source="checklist", checklist_errors=errors),
        [ConversationItem(kind="run-context", seq=0)],
    )
    return s


def test_checklist_entry_flow_wires_diagnose_through_await_recheck_to_decision():
    """Smoke test for the second entry path: checklist.diagnose ->
    checklist.propose -> fix.apply -> checklist.await_recheck, then a
    recheck(passed=True) action hands off to the shared fix.await_decision
    gate, proving the checklist path merges back into the run-fix machinery."""
    env, repo, dify = _new_env()
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]
    s = _seed_checklist_session(repo, errors)

    runner = Runner(env, fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    # low-risk placeholder repair => auto-advance diagnose -> propose -> apply
    # -> checklist.await_recheck (no approval gate).
    assert out.current_state == PcState.CHECKLIST_AWAIT_RECHECK
    assert not canvas_read_only(out.current_state)
    assert canvas_read_only(PcState.CHECKLIST_DIAGNOSE)
    assert canvas_read_only(PcState.CHECKLIST_PROPOSE)
    assert canvas_read_only(PcState.FIX_APPLY)

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "n1"
    assert fc.checkpoint_id, "checklist diagnose must also create a checkpoint before mutation"
    assert dify.applied

    turn = Turn(action=Action(kind="recheck", payload={"passed": True}, base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION
    assert not canvas_read_only(out.current_state)
