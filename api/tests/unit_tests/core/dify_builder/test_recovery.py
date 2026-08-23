from datetime import datetime

from core.dify_builder.contract import RecoveryClass
from core.dify_builder.handlers_fix import fix_registry
from core.dify_builder.models import (
    Action,
    ChecklistError,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
    Turn,
)
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState, is_waiting, is_working
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def _actor():
    from core.dify_builder.models import Actor
    return Actor(account_id="a", tenant_id="t")


# ---- entry_state_for -------------------------------------------------------

def test_entry_state_for_all_modes():
    """Parity test for entry_state_for's docstring claim ("mirrors
    service.create_*_session; a parity test guards drift"). The expected
    mapping below is exactly what services.dify_builder.service assigns
    as the initial ``Session.current_state`` for each mode:
      - create_fix_session: EntryMode.FIX -> PcState.FIX_DIAGNOSE,
        EntryMode.FIX_CHECKLIST -> PcState.CHECKLIST_DIAGNOSE (branches on
        whether checklist_errors were passed).
      - create_build_session: EntryMode.BUILD -> PcState.BUILD_CAPABILITY_CHECK.
      - create_edit_session: EntryMode.EDIT -> PcState.EDIT_CAPABILITY_CHECK.
    We assert the known mapping directly (no need to call the service
    functions) so this stays a light core-layer test; if either side drifts
    a fresh session would start somewhere entry_state_for doesn't expect,
    which is exactly the drift this test guards against.
    """
    from core.dify_builder import recovery

    assert recovery.entry_state_for(EntryMode.FIX) == PcState.FIX_DIAGNOSE
    assert recovery.entry_state_for(EntryMode.FIX_CHECKLIST) == PcState.CHECKLIST_DIAGNOSE
    assert recovery.entry_state_for(EntryMode.BUILD) == PcState.BUILD_CAPABILITY_CHECK
    assert recovery.entry_state_for(EntryMode.EDIT) == PcState.EDIT_CAPABILITY_CHECK


# ---- target_node_ids -------------------------------------------------------

def test_target_node_ids_per_mode():
    from core.dify_builder import recovery

    build_fc = DifyBuilderContext(built_node_ids=["n1", "n2"])
    assert recovery.target_node_ids(build_fc, EntryMode.BUILD) == ["n1", "n2"]

    edit_fc = DifyBuilderContext(edit_target_node_ids=["e1"])
    assert recovery.target_node_ids(edit_fc, EntryMode.EDIT) == ["e1"]

    fix_fc = DifyBuilderContext(diagnosis=Diagnosis(culprit_node_id="c1"))
    assert recovery.target_node_ids(fix_fc, EntryMode.FIX) == ["c1"]

    checklist_fc = DifyBuilderContext(
        checklist_errors=[ChecklistError(node_id="k1"), ChecklistError(node_id="k2")],
        diagnosis=Diagnosis(culprit_node_id="k2"),
    )
    # checklist error node ids, with the culprit deduped in.
    assert recovery.target_node_ids(checklist_fc, EntryMode.FIX_CHECKLIST) == ["k1", "k2"]


def test_target_node_ids_fix_guard_branches():
    from core.dify_builder import recovery

    # no diagnosis yet (e.g. recovery checked before diagnose ever ran).
    assert recovery.target_node_ids(DifyBuilderContext(), EntryMode.FIX) == []

    # a diagnosis with no resolved culprit node.
    fc = DifyBuilderContext(diagnosis=Diagnosis(culprit_node_id=""))
    assert recovery.target_node_ids(fc, EntryMode.FIX) == []


# ---- classify --------------------------------------------------------------

def test_classify_unchanged():
    from core.dify_builder import recovery

    fc = DifyBuilderContext(last_snapshot_hash="h1", last_structure_fingerprint="fp1")
    assert recovery.classify("h1", "fp-anything", [], fc, EntryMode.BUILD) == RecoveryClass.UNCHANGED


def test_classify_config_only():
    from core.dify_builder import recovery

    fc = DifyBuilderContext(last_snapshot_hash="h1", last_structure_fingerprint="fp1")
    assert recovery.classify("h2", "fp1", [], fc, EntryMode.BUILD) == RecoveryClass.CONFIG_ONLY


def test_classify_structural_compatible():
    from core.dify_builder import recovery

    fc = DifyBuilderContext(
        last_snapshot_hash="h1", last_structure_fingerprint="fp1", built_node_ids=["n1"],
    )
    # hash + fingerprint changed, but target n1 still present.
    assert recovery.classify("h2", "fp2", ["n1", "n2"], fc, EntryMode.BUILD) == RecoveryClass.STRUCTURAL_COMPATIBLE


def test_classify_structural_invalidating():
    from core.dify_builder import recovery

    fc = DifyBuilderContext(
        last_snapshot_hash="h1", last_structure_fingerprint="fp1", built_node_ids=["n1"],
    )
    # target n1 gone from the current graph.
    assert recovery.classify("h2", "fp2", ["n2"], fc, EntryMode.BUILD) == RecoveryClass.STRUCTURAL_INVALIDATING


# ---- apply_recovery_action via the runner ----------------------------------

def _seed(repo, entry_mode, state, fc):
    s = Session(app_id="app", tenant_id="t", owner_account_id="a", entry_mode=entry_mode, current_state=state)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


def test_check_recovery_sets_class_and_appends_notice():
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "n1", "data": {"type": "llm"}}], "edges": []}
    dify.hash = "h-new"
    repo = InMemoryRepository()
    # last-known: different hash, matching fingerprint -> config_only.
    fc = DifyBuilderContext(
        last_snapshot_hash="h-old",
        last_structure_fingerprint=dify.structural_fingerprint(dify.graph),
        next_seq=1,
    )
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    out = runner.advance(s.id, Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()))

    assert out.current_state == PcState.BUILD_REVIEW  # same state
    assert out.version == 2                            # committed
    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == "config_only"
    convo = repo.list_conversation(s.id)
    assert any(item.kind == "notice" for item in convo[1:])  # a notice was appended


def test_check_recovery_classifies_unchanged_via_runner():
    """The remaining classify() classes, exercised end-to-end through the
    runner's check_recovery path (test_check_recovery_sets_class_and_appends_notice
    above already covers CONFIG_ONLY)."""
    dify = FakeDifyPort()  # graph {"nodes": []}, hash "h0" (untouched)
    repo = InMemoryRepository()
    # last-known hash matches the current one -> unchanged, regardless of fingerprint.
    fc = DifyBuilderContext(last_snapshot_hash=dify.hash, last_structure_fingerprint="stale-fp", next_seq=1)
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    runner.advance(s.id, Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()))

    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == "unchanged"


def test_check_recovery_classifies_structural_compatible_via_runner():
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "n1", "data": {"type": "llm"}}, {"id": "n2", "data": {"type": "llm"}}], "edges": []}
    dify.hash = "h-new"
    repo = InMemoryRepository()
    # hash + fingerprint both changed, but the build target n1 is still present.
    fc = DifyBuilderContext(
        last_snapshot_hash="h-old", last_structure_fingerprint="stale-fp", built_node_ids=["n1"], next_seq=1,
    )
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    runner.advance(s.id, Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()))

    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == "structural_compatible"


def test_check_recovery_classifies_structural_invalidating_via_runner():
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "n2", "data": {"type": "llm"}}], "edges": []}
    dify.hash = "h-new"
    repo = InMemoryRepository()
    # hash + fingerprint both changed, and the build target n1 is gone from the graph.
    fc = DifyBuilderContext(
        last_snapshot_hash="h-old", last_structure_fingerprint="stale-fp", built_node_ids=["n1"], next_seq=1,
    )
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    runner.advance(s.id, Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()))

    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == "structural_invalidating"


def test_recovery_continue_clears_class():
    dify = FakeDifyPort()
    repo = InMemoryRepository()
    fc = DifyBuilderContext(recovery_class="config_only", next_seq=1)
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    out = runner.advance(s.id, Turn(action=Action(kind="recovery_continue", base_version=1), actor=_actor()))

    assert out.current_state == PcState.BUILD_REVIEW
    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == ""


def test_recovery_restart_resets_to_entry_state_and_preserves_conversation():
    dify = FakeDifyPort()
    repo = InMemoryRepository()
    fc = DifyBuilderContext(
        recovery_class="structural_invalidating",
        built_node_ids=["n1"],
        plan_items=["step"],
        checkpoint_id="cp1",
        goal_text="build me a thing",
        next_seq=1,
    )
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    out = runner.advance(s.id, Turn(action=Action(kind="recovery_restart", base_version=1), actor=_actor()))

    assert out.current_state == PcState.BUILD_CAPABILITY_CHECK  # entry state for BUILD
    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == ""
    assert fc2.built_node_ids == []
    assert fc2.plan_items == []
    assert fc2.checkpoint_id == ""
    assert fc2.goal_text == "build me a thing"   # preserved
    assert len(repo.list_conversation(s.id)) >= 1  # conversation preserved (+ restart notice)


# ---- recovery_restart into a WORKING entry state must be driven, not stranded (FINDING 1) --


def _engine_env() -> tuple[Env, InMemoryRepository, FakeDifyPort]:
    """A real engine env (PlaceholderAgent + FakeDifyPort + InMemoryRepository),
    mirroring test_fix_flow.py's _new_env -- needed here because, unlike the
    BUILD/EDIT recovery_restart tests above (registry={}), a FIX/FIX_CHECKLIST
    restart lands on a WORKING state (fix.diagnose / checklist.diagnose) that
    the runner must actually drive through real handlers."""
    repo = InMemoryRepository()
    dify = FakeDifyPort()
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min)
    return env, repo, dify


def test_recovery_restart_in_fix_mode_drives_working_entry_state_to_waiting():
    """FINDING 1 regression: before the runner fix, the check_recovery /
    recovery_continue / recovery_restart short-circuit committed the
    transition into fix.diagnose (a WORKING state) and then returned
    immediately, without entering the advance loop that drives working
    states through their handlers. The session was left resting at
    fix.diagnose with no UI actions -- get_session_view reports
    interrupted=True and nothing ever re-drives it. This is the FORCED path
    for structural_invalidating drift (can_continue=False), so it must not
    strand the session. Asserts the post-fix behavior: recovery_restart
    drives fix.diagnose -> fix.propose -> fix.apply (PlaceholderAgent's
    canned repair is low-risk, so no approval gate) and rests at the next
    genuine waiting state, exactly like any other transition into a working
    state (e.g. request_fix in test_fix_flow.py). This test fails against
    the old runner (out.current_state == PcState.FIX_DIAGNOSE, a working
    state) and passes after the fix.
    """
    env, repo, dify = _engine_env()
    fc = DifyBuilderContext(failed_run_id="TR-1", recovery_class="structural_invalidating", next_seq=1)
    s = _seed(repo, EntryMode.FIX, PcState.FIX_AWAIT_DECISION, fc)
    repo.save_run(s.id, Run(id="TR-1", kind="original-failed", status="failed", immutable=True))

    runner = Runner(env, fix_registry())
    out = runner.advance(s.id, Turn(action=Action(kind="recovery_restart", base_version=1), actor=_actor()))

    # not stranded at the working entry state ...
    assert out.current_state != PcState.FIX_DIAGNOSE
    # ... it was driven forward to a genuine waiting state with actions.
    assert is_waiting(out.current_state)
    assert not is_working(out.current_state)

    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == ""
    assert fc2.diagnosis is not None, "fix.diagnose's handler must have actually run"
    assert dify.applied, "the drive must have reached fix.apply and applied the repair"


def test_recovery_restart_in_fix_checklist_mode_drives_working_entry_state_to_waiting():
    """FINDING 1 regression, checklist entry mode: recovery_restart must not
    strand the session at checklist.diagnose (also a WORKING state). Mirrors
    the FIX test above; the checklist flow instead rests at
    checklist.await_recheck once handle_apply routes on fc.source ==
    'checklist' (see test_fix_flow.py's checklist-entry smoke test)."""
    env, repo, dify = _engine_env()
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]
    fc = DifyBuilderContext(
        source="checklist", checklist_errors=errors, recovery_class="structural_invalidating", next_seq=1,
    )
    s = _seed(repo, EntryMode.FIX_CHECKLIST, PcState.CHECKLIST_AWAIT_RECHECK, fc)

    runner = Runner(env, fix_registry())
    out = runner.advance(s.id, Turn(action=Action(kind="recovery_restart", base_version=1), actor=_actor()))

    # not stranded at the working entry state ...
    assert out.current_state != PcState.CHECKLIST_DIAGNOSE
    # ... it was driven forward to a genuine waiting state with actions.
    assert is_waiting(out.current_state)
    assert not is_working(out.current_state)

    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == ""
    assert fc2.diagnosis is not None, "checklist.diagnose's handler must have actually run"
    assert dify.applied, "the drive must have reached fix.apply and applied the repair"
