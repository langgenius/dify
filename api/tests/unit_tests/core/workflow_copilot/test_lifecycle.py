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
