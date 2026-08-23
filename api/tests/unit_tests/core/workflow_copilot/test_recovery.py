from datetime import datetime

from core.workflow_copilot.contract import RecoveryClass
from core.workflow_copilot.models import (
    Action, ChecklistError, ConversationItem, CopilotContext, Diagnosis, EntryMode, Session, Turn,
)
from core.workflow_copilot.runner import Env, Runner
from core.workflow_copilot.state import PcState
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def _actor():
    from core.workflow_copilot.models import Actor
    return Actor(account_id="a", tenant_id="t")


# ---- entry_state_for -------------------------------------------------------

def test_entry_state_for_all_modes():
    from core.workflow_copilot import recovery

    assert recovery.entry_state_for(EntryMode.FIX) == PcState.FIX_DIAGNOSE
    assert recovery.entry_state_for(EntryMode.FIX_CHECKLIST) == PcState.CHECKLIST_DIAGNOSE
    assert recovery.entry_state_for(EntryMode.BUILD) == PcState.BUILD_CAPABILITY_CHECK
    assert recovery.entry_state_for(EntryMode.EDIT) == PcState.EDIT_CAPABILITY_CHECK


# ---- target_node_ids -------------------------------------------------------

def test_target_node_ids_per_mode():
    from core.workflow_copilot import recovery

    build_fc = CopilotContext(built_node_ids=["n1", "n2"])
    assert recovery.target_node_ids(build_fc, EntryMode.BUILD) == ["n1", "n2"]

    edit_fc = CopilotContext(edit_target_node_ids=["e1"])
    assert recovery.target_node_ids(edit_fc, EntryMode.EDIT) == ["e1"]

    fix_fc = CopilotContext(diagnosis=Diagnosis(culprit_node_id="c1"))
    assert recovery.target_node_ids(fix_fc, EntryMode.FIX) == ["c1"]

    checklist_fc = CopilotContext(
        checklist_errors=[ChecklistError(node_id="k1"), ChecklistError(node_id="k2")],
        diagnosis=Diagnosis(culprit_node_id="k2"),
    )
    # checklist error node ids, with the culprit deduped in.
    assert recovery.target_node_ids(checklist_fc, EntryMode.FIX_CHECKLIST) == ["k1", "k2"]


# ---- classify --------------------------------------------------------------

def test_classify_unchanged():
    from core.workflow_copilot import recovery

    fc = CopilotContext(last_snapshot_hash="h1", last_structure_fingerprint="fp1")
    assert recovery.classify("h1", "fp-anything", [], fc, EntryMode.BUILD) == RecoveryClass.UNCHANGED


def test_classify_config_only():
    from core.workflow_copilot import recovery

    fc = CopilotContext(last_snapshot_hash="h1", last_structure_fingerprint="fp1")
    assert recovery.classify("h2", "fp1", [], fc, EntryMode.BUILD) == RecoveryClass.CONFIG_ONLY


def test_classify_structural_compatible():
    from core.workflow_copilot import recovery

    fc = CopilotContext(
        last_snapshot_hash="h1", last_structure_fingerprint="fp1", built_node_ids=["n1"],
    )
    # hash + fingerprint changed, but target n1 still present.
    assert recovery.classify("h2", "fp2", ["n1", "n2"], fc, EntryMode.BUILD) == RecoveryClass.STRUCTURAL_COMPATIBLE


def test_classify_structural_invalidating():
    from core.workflow_copilot import recovery

    fc = CopilotContext(
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
    fc = CopilotContext(
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


def test_recovery_continue_clears_class():
    dify = FakeDifyPort()
    repo = InMemoryRepository()
    fc = CopilotContext(recovery_class="config_only", next_seq=1)
    s = _seed(repo, EntryMode.BUILD, PcState.BUILD_REVIEW, fc)
    runner = Runner(Env(dify=dify, agent=StubAgent(), repo=repo, now=lambda: datetime.min), {})

    out = runner.advance(s.id, Turn(action=Action(kind="recovery_continue", base_version=1), actor=_actor()))

    assert out.current_state == PcState.BUILD_REVIEW
    _s, fc2 = repo.get_session(s.id)
    assert fc2.recovery_class == ""


def test_recovery_restart_resets_to_entry_state_and_preserves_conversation():
    dify = FakeDifyPort()
    repo = InMemoryRepository()
    fc = CopilotContext(
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
