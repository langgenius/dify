"""Slice 4 session-lifecycle-core tests: restore_graph, invalidation, revert,
checkpoint surfacing, pause/resume."""

from core.workflow_copilot.models import Actor
from core.workflow_copilot.ports import DifyPort
from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort, FakeDifyPort


def _actor() -> Actor:
    return Actor(account_id="a", tenant_id="t")


def test_fake_dify_port_restore_graph_swaps_graph_and_returns_hash():
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "x"}]}
    snapshot = {"nodes": [{"id": "start"}, {"id": "end"}]}
    new_hash = dify.restore_graph("app", _actor(), snapshot)
    assert isinstance(new_hash, str)
    assert new_hash
    got, got_hash = dify.read_graph("app", _actor())
    assert got == snapshot
    assert got_hash == new_hash
    # deep-copied: mutating the caller's graph does not corrupt the fake
    snapshot["nodes"].append({"id": "leak"})
    assert len(dify.read_graph("app", _actor())[0]["nodes"]) == 2


def test_fake_build_dify_port_restore_graph_swaps_graph():
    dify = FakeBuildDifyPort()
    dify.graph = {"nodes": [{"id": "a"}], "edges": []}
    snapshot = {"nodes": [], "edges": []}
    dify.restore_graph("app", _actor(), snapshot)
    assert dify.read_graph("app", _actor())[0] == {"nodes": [], "edges": []}


def test_fake_dify_ports_still_satisfy_dify_port_protocol():
    assert isinstance(FakeDifyPort(), DifyPort)
    assert isinstance(FakeBuildDifyPort(), DifyPort)


def test_in_memory_invalidate_flips_assistant_turns_from_seq():
    from core.workflow_copilot.models import ConversationItem, CopilotContext, EntryMode, Session
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import InMemoryRepository

    repo = InMemoryRepository()
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_REVIEW)
    items = [
        ConversationItem(seq=0, kind="assistant_turn", payload={"turn_id": "t0"}),
        ConversationItem(seq=1, kind="decision", payload={"text": "x"}),
        ConversationItem(seq=2, kind="assistant_turn", payload={"turn_id": "t2"}),
        ConversationItem(seq=3, kind="assistant_turn", payload={"turn_id": "t3"}),
    ]
    repo.create_session(s, CopilotContext(), items)

    repo.invalidate_conversation_items(s.id, from_seq=2)

    by_seq = {i.seq: i for i in repo.list_conversation(s.id)}
    assert "card_state" not in by_seq[0].payload          # before boundary: untouched
    assert by_seq[1].payload.get("card_state") is None      # non-assistant_turn: untouched
    assert by_seq[2].payload["card_state"] == "invalidated"  # >= boundary, assistant_turn
    assert by_seq[3].payload["card_state"] == "invalidated"


def test_fix_await_decision_undo_restores_draft_and_invalidates():
    from datetime import datetime

    from core.workflow_copilot.handlers_fix import handle_await_decision
    from core.workflow_copilot.models import Action, ConversationItem, CopilotContext, EntryMode, Session, Turn
    from core.workflow_copilot.placeholder_agent import PlaceholderAgent
    from core.workflow_copilot.runner import Env
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository

    repo = InMemoryRepository()
    dify = FakeDifyPort()
    events: list[dict] = []
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min, emit_canvas=events.append)

    # seed a session at await_decision with a minted checkpoint (pre-fix snapshot)
    # and an approval assistant_turn at seq 1 (checkpoint_seq boundary = 1).
    from core.workflow_copilot.models import Checkpoint, Snapshot
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.FIX, current_state=PcState.FIX_AWAIT_DECISION)
    fc = CopilotContext(checkpoint_seq=1)
    items = [
        ConversationItem(seq=0, kind="run_context", payload={}),
        ConversationItem(seq=2, kind="assistant_turn", payload={"turn_id": "approve"}),
    ]
    repo.create_session(s, fc, items)
    cp = Checkpoint(session_id=s.id, state=PcState.FIX_PROPOSE)
    repo.create_checkpoint(cp, Snapshot(session_id=s.id, hash="h0", graph={"nodes": [{"id": "start"}]}))
    _s, fc = repo.get_session(s.id)
    fc.checkpoint_id = cp.id
    # the draft was mutated by the (now-reverted) fix:
    dify.graph = {"nodes": [{"id": "start"}, {"id": "added-by-fix"}]}

    res = handle_await_decision(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), s, fc)

    assert res.next == PcState.SUCCESS
    # draft restored to the checkpoint snapshot
    assert dify.read_graph("app", _actor())[0] == {"nodes": [{"id": "start"}]}
    # active restore point cleared
    assert res.context.checkpoint_id == ""
    # revert_checkpoint canvas emitted
    assert {"event": "revert_checkpoint"} in events
    # approval assistant_turn (seq 2 >= boundary 1) invalidated
    by_seq = {i.seq: i for i in repo.list_conversation(s.id)}
    assert by_seq[2].payload["card_state"] == "invalidated"


def test_perform_revert_without_checkpoint_is_graceful_noop():
    from datetime import datetime

    from core.workflow_copilot.handlers_fix import perform_revert
    from core.workflow_copilot.models import CopilotContext, EntryMode, Session, Turn
    from core.workflow_copilot.placeholder_agent import PlaceholderAgent
    from core.workflow_copilot.runner import Env
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository

    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "keep"}]}
    events: list[dict] = []
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=InMemoryRepository(),
              now=lambda: datetime.min, emit_canvas=events.append)
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.FIX, current_state=PcState.FIX_AWAIT_DECISION)
    fc = CopilotContext()  # no checkpoint_id

    perform_revert(env, Turn(action=None, actor=_actor()), s, fc)

    assert {"event": "revert_checkpoint"} in events   # signal still fires
    assert dify.read_graph("app", _actor())[0] == {"nodes": [{"id": "keep"}]}  # no restore


def test_build_review_undo_restores_pre_build_graph():
    from datetime import datetime

    from core.workflow_copilot.handlers_build import handle_review
    from core.workflow_copilot.models import (
        Action,
        Checkpoint,
        ConversationItem,
        CopilotContext,
        EntryMode,
        Session,
        Snapshot,
        Turn,
    )
    from core.workflow_copilot.placeholder_agent import PlaceholderAgent
    from core.workflow_copilot.runner import Env
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort, InMemoryRepository

    repo = InMemoryRepository()
    dify = FakeBuildDifyPort()
    events: list[dict] = []
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min, emit_canvas=events.append)

    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_REVIEW)
    fc = CopilotContext(checkpoint_seq=0, built_node_ids=["start", "llm", "end"])
    repo.create_session(s, fc, [ConversationItem(seq=0, kind="assistant_turn", payload={"turn_id": "approve"})])
    cp = Checkpoint(session_id=s.id, state=PcState.BUILD_PLAN_APPROVAL)
    repo.create_checkpoint(cp, Snapshot(session_id=s.id, hash="h0", graph={"nodes": [], "edges": []}))
    _s, fc = repo.get_session(s.id)
    fc.checkpoint_id = cp.id
    dify.graph = {
        "nodes": [{"id": "start"}, {"id": "llm"}, {"id": "end"}],
        "edges": [{"source": "start", "target": "llm"}],
    }

    res = handle_review(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), s, fc)

    assert res.next == PcState.BUILD_REVERTED
    assert dify.read_graph("app", _actor())[0] == {"nodes": [], "edges": []}  # pre-build graph restored
    assert res.context.checkpoint_id == ""
    assert {"event": "revert_checkpoint"} in events
    by_seq = {i.seq: i for i in repo.list_conversation(s.id)}
    assert by_seq[0].payload["card_state"] == "invalidated"


def test_edit_apply_changes_undo_restores_pre_edit_graph():
    from datetime import datetime

    from core.workflow_copilot.handlers_edit import handle_apply_changes
    from core.workflow_copilot.models import (
        Action,
        Checkpoint,
        ConversationItem,
        CopilotContext,
        EntryMode,
        Session,
        Snapshot,
        Turn,
    )
    from core.workflow_copilot.placeholder_agent import PlaceholderAgent
    from core.workflow_copilot.runner import Env
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import FakeEditDifyPort, InMemoryRepository

    repo = InMemoryRepository()
    dify = FakeEditDifyPort()
    events: list[dict] = []
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min, emit_canvas=events.append)

    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_APPLY_CHANGES)
    fc = CopilotContext(checkpoint_seq=0, edit_target_node_ids=["llm"])
    repo.create_session(s, fc, [ConversationItem(seq=0, kind="assistant_turn", payload={"turn_id": "approve"})])
    pre_edit = {"nodes": [{"id": "llm", "data": {}}], "edges": []}
    cp = Checkpoint(session_id=s.id, state=PcState.EDIT_PLAN_APPROVAL)
    repo.create_checkpoint(cp, Snapshot(session_id=s.id, hash="h0", graph=pre_edit))
    _s, fc = repo.get_session(s.id)
    fc.checkpoint_id = cp.id
    dify.graph = {"nodes": [{"id": "llm", "data": {"risk_threshold": "high"}}], "edges": []}

    res = handle_apply_changes(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), s, fc)

    assert res.next == PcState.EDIT_REVERTED
    assert dify.read_graph("app", _actor())[0] == pre_edit  # config edit undone
    assert res.context.checkpoint_id == ""
    assert {"event": "revert_checkpoint"} in events
    by_seq = {i.seq: i for i in repo.list_conversation(s.id)}
    assert by_seq[0].payload["card_state"] == "invalidated"


def test_runner_stop_sets_paused_same_state_and_bumps_version():
    from datetime import datetime

    from core.workflow_copilot.models import Action, ConversationItem, CopilotContext, EntryMode, Session, Turn
    from core.workflow_copilot.placeholder_agent import PlaceholderAgent
    from core.workflow_copilot.runner import Env, Runner
    from core.workflow_copilot.state import PcState
    from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository

    repo = InMemoryRepository()
    env = Env(dify=FakeDifyPort(), agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min)
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_REVIEW)
    repo.create_session(s, CopilotContext(), [ConversationItem(kind="user", seq=0)])
    runner = Runner(env, {})  # empty registry: stop must not need a handler

    out = runner.advance(s.id, Turn(action=Action(kind="stop", base_version=1), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW  # unchanged
    assert out.version == 2                            # committed
    _s, fc = repo.get_session(s.id)
    assert fc.paused is True

    out = runner.advance(s.id, Turn(action=Action(kind="resume", base_version=2), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW
    _s, fc = repo.get_session(s.id)
    assert fc.paused is False


def test_run_status_paused_when_flag_set():
    from core.workflow_copilot.contract import RunStatus
    from core.workflow_copilot.state import PcState
    from services.workflow_copilot.service import _run_status

    assert _run_status(PcState.BUILD_REVIEW, paused=True) == RunStatus.PAUSED
    assert _run_status(PcState.BUILD_REVIEW, paused=False) == RunStatus.WAITING_INPUT
    # paused never overrides terminal/failed
    assert _run_status(PcState.BUILD_COMPLETE, paused=True) == RunStatus.COMPLETE
