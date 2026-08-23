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
