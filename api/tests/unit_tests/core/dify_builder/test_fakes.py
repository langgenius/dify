"""Tests for the in-memory fakes (`InMemoryRepository`, `FakeDifyPort`, `StubAgent`).

Port of the behavioral guarantees dify-enterprise/server/pkg/enterprise/
biz/dify_builder/fakes_test.go's memRepo/FakeDify/StubAgent give the Go test
suite, plus the fix from the Go code review noted in the P1 port plan
(Task 4): the Go `memRepo.CompareAndAdvance` never checked
`(session_id, seq)` uniqueness on appended conversation items, silently
hiding a bug. This suite asserts the added real uniqueness guard as a
first-class behavior, not an afterthought.
"""

from dataclasses import replace
from typing import Unpack

import pytest

from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import (
    Actor,
    Checkpoint,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    MutationIntent,
    Run,
    Session,
    Snapshot,
    TestInput,
)
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, SessionOverrides


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _session(**overrides: Unpack[SessionOverrides]) -> Session:
    return replace(
        Session(
            app_id="app",
            tenant_id="t",
            owner_account_id="u",
            entry_mode=EntryMode.FIX,
            current_state=PcState.FIX_DIAGNOSE,
        ),
        **overrides,
    )


# ---- InMemoryRepository.create_session ------------------------------------


def test_create_session_assigns_id_and_starts_at_version_1() -> None:
    repo = InMemoryRepository()
    s = _session()

    repo.create_session(s, DifyBuilderContext(), [])

    assert s.id != ""
    assert s.version == 1
    stored, stored_fc = repo.get_session(s.id)
    assert stored.version == 1
    assert stored.current_state == PcState.FIX_DIAGNOSE
    assert stored_fc.next_seq == 0


def test_create_session_sets_next_seq_to_seed_item_count() -> None:
    repo = InMemoryRepository()
    s = _session()
    fc = DifyBuilderContext()
    items = [
        ConversationItem(seq=0, kind="run-context", at_version=1),
        ConversationItem(seq=1, kind="user", at_version=1),
    ]

    repo.create_session(s, fc, items)

    # Mutated in place, mirroring the Go pointer semantics (fc.NextSeq = ...).
    assert fc.next_seq == 2
    _, stored_fc = repo.get_session(s.id)
    assert stored_fc.next_seq == 2
    assert [item.kind for item in repo.list_conversation(s.id)] == ["run-context", "user"]


def test_create_session_does_not_downgrade_an_already_larger_next_seq() -> None:
    repo = InMemoryRepository()
    s = _session()
    fc = DifyBuilderContext(next_seq=5)

    repo.create_session(s, fc, [])

    assert fc.next_seq == 5


def test_create_session_rejects_duplicate_seq_within_seed_items() -> None:
    repo = InMemoryRepository()
    s = _session()
    items = [
        ConversationItem(seq=0, kind="a", at_version=1),
        ConversationItem(seq=0, kind="b", at_version=1),
    ]

    with pytest.raises(ConflictError):
        repo.create_session(s, DifyBuilderContext(), items)


# ---- compare_and_advance: version CAS -------------------------------------


def test_compare_and_advance_rejects_stale_base_version() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    with pytest.raises(ConflictError):
        repo.compare_and_advance(s.id, 0, PcState.FIX_PROPOSE, DifyBuilderContext(), [])

    # Nothing applied.
    stored, _ = repo.get_session(s.id)
    assert stored.version == 1
    assert stored.current_state == PcState.FIX_DIAGNOSE


def test_compare_and_advance_accepts_current_version_and_bumps_it() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    new_version = repo.compare_and_advance(
        s.id,
        1,
        PcState.FIX_PROPOSE,
        DifyBuilderContext(diagnosis=Diagnosis(culprit_node_id="n1")),
        [],
    )

    assert new_version == 2
    stored, stored_fc = repo.get_session(s.id)
    assert stored.version == 2
    assert stored.current_state == PcState.FIX_PROPOSE
    assert stored_fc.diagnosis is not None
    assert stored_fc.diagnosis.culprit_node_id == "n1"


def test_compare_and_advance_on_unknown_session_raises_not_found() -> None:
    repo = InMemoryRepository()

    with pytest.raises(NotFoundError):
        repo.compare_and_advance("nope", 1, PcState.FIX_PROPOSE, DifyBuilderContext(), [])


def test_compare_and_advance_deep_copies_the_stored_context() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    fc = DifyBuilderContext(staged_repair=[MutationIntent(op="set_node_config")])
    repo.compare_and_advance(s.id, 1, PcState.FIX_APPLY, fc, [])

    # Mutating the caller's fc after the commit must not affect stored state.
    fc.staged_repair.append(MutationIntent(op="connect"))
    _, stored_fc = repo.get_session(s.id)
    assert len(stored_fc.staged_repair) == 1


# ---- compare_and_advance: (session_id, seq) uniqueness --------------------
# This is the fix for the bug the Go review flagged: memRepo never checked
# this, so a duplicate/out-of-order append silently "succeeded".


def test_compare_and_advance_rejects_duplicate_seq_within_one_batch() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    dup_items = [
        ConversationItem(seq=0, kind="a", at_version=2),
        ConversationItem(seq=0, kind="b", at_version=2),
    ]

    with pytest.raises(ConflictError):
        repo.compare_and_advance(s.id, 1, PcState.FIX_PROPOSE, DifyBuilderContext(), dup_items)

    # Nothing applied: neither version nor conversation items advanced.
    stored, _ = repo.get_session(s.id)
    assert stored.version == 1
    assert repo.list_conversation(s.id) == []


def test_compare_and_advance_rejects_seq_reused_from_a_previous_commit() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(seq=0, kind="run-context", at_version=1)])

    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            s.id,
            1,
            PcState.FIX_PROPOSE,
            DifyBuilderContext(),
            [ConversationItem(seq=0, kind="user", at_version=2)],
        )

    stored, _ = repo.get_session(s.id)
    assert stored.version == 1  # nothing applied
    assert len(repo.list_conversation(s.id)) == 1


def test_compare_and_advance_accepts_the_next_seq_in_order() -> None:
    repo = InMemoryRepository()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(seq=0, kind="run-context", at_version=1)])

    repo.compare_and_advance(
        s.id,
        1,
        PcState.FIX_PROPOSE,
        DifyBuilderContext(),
        [ConversationItem(seq=1, kind="user", at_version=2)],
    )

    items = repo.list_conversation(s.id)
    assert [item.seq for item in items] == [0, 1]


# ---- getters raise NotFoundError, never None ------------------------------


def test_get_session_raises_not_found_when_absent() -> None:
    repo = InMemoryRepository()
    with pytest.raises(NotFoundError):
        repo.get_session("nope")


def test_get_checkpoint_raises_not_found_when_absent() -> None:
    repo = InMemoryRepository()
    with pytest.raises(NotFoundError):
        repo.get_checkpoint("nope")


def test_get_run_raises_not_found_when_absent() -> None:
    repo = InMemoryRepository()
    with pytest.raises(NotFoundError):
        repo.get_run("nope")


def test_get_test_input_raises_not_found_when_absent() -> None:
    repo = InMemoryRepository()
    with pytest.raises(NotFoundError):
        repo.get_test_input("nope")


# ---- checkpoints: create/get + deep-copy round trip -----------------------


def test_create_and_get_checkpoint_round_trips_and_deep_copies_the_graph() -> None:
    repo = InMemoryRepository()
    graph = {"nodes": [{"id": "n1"}]}
    snap = Snapshot(session_id="sess-1", hash="h1", graph=graph)
    cp = Checkpoint(session_id="sess-1", state=PcState.FIX_APPLY)

    repo.create_checkpoint(cp, snap)

    assert cp.id != ""
    assert snap.id != ""
    assert cp.snapshot_id == snap.id

    # Mutating the caller's graph post-create must not affect stored state.
    graph["nodes"].append({"id": "n2"})

    got_cp, got_snap = repo.get_checkpoint(cp.id)
    assert got_cp.state == PcState.FIX_APPLY
    assert got_snap.graph == {"nodes": [{"id": "n1"}]}

    # Mutating the *returned* graph must not affect the stored copy either
    # (this is what makes checkpoint-restore genuinely testable).
    got_snap.graph["nodes"].append({"id": "n3"})
    got_cp2, got_snap2 = repo.get_checkpoint(cp.id)
    assert got_snap2.graph == {"nodes": [{"id": "n1"}]}


# ---- runs: save/get round trip + immutability ------------------------------


def test_save_and_get_run_round_trips_and_assigns_id() -> None:
    repo = InMemoryRepository()
    r = Run(kind="verify", status="succeeded", immutable=True)

    repo.save_run("sess-1", r)

    assert r.id != ""
    got = repo.get_run(r.id)
    assert got.status == "succeeded"
    assert got.immutable is True


def test_save_run_rejects_overwriting_an_immutable_run() -> None:
    repo = InMemoryRepository()
    r = Run(id="TR-1", kind="original-failed", status="failed", immutable=True)
    repo.save_run("sess-1", r)

    with pytest.raises(ValueError, match="immutable"):
        repo.save_run("sess-1", Run(id="TR-1", status="succeeded"))


# ---- test inputs: save/get round trip --------------------------------------


def test_save_and_get_test_input_round_trips_and_assigns_id() -> None:
    repo = InMemoryRepository()
    ti = TestInput(session_id="sess-1", source="mock", inputs={"query": "x"})

    repo.save_test_input(ti)

    assert ti.id != ""
    got = repo.get_test_input(ti.id)
    assert got.inputs == {"query": "x"}


# ---- list_conversation ------------------------------------------------------


def test_list_conversation_returns_empty_list_for_unknown_session() -> None:
    repo = InMemoryRepository()
    assert repo.list_conversation("nope") == []


# ---- FakeDifyPort ------------------------------------------------------------


def test_fake_dify_port_read_graph_returns_canned_graph_and_hash_and_deep_copies() -> None:
    port = FakeDifyPort()

    graph, h = port.read_graph("app-1", _actor())

    assert h == port.hash
    graph["nodes"].append({"id": "mutated"})
    graph2, _ = port.read_graph("app-1", _actor())
    assert graph2 == {"nodes": []}


def test_fake_dify_port_apply_repair_records_intents_and_returns_result() -> None:
    port = FakeDifyPort()
    intents = [MutationIntent(op="set_node_config", args={"node_id": "n1", "field": "metrics", "value": "[]"})]

    result = port.apply_repair("app-1", _actor(), intents)

    assert port.applied == intents
    assert result.changed_nodes == ["n1"]
    assert result.new_hash == port.hash


def test_fake_dify_port_run_draft_emits_events_and_returns_configured_status() -> None:
    port = FakeDifyPort()
    events = []

    port.verify_pass = False
    run = port.run_draft(
        "app-1", _actor(), {"query": "x"}, events.append, session_id="session-1", test_input_id="test-1"
    )

    assert run.status == "failed"
    assert len(events) == 2
    assert port.run_draft_inputs == {"query": "x"}

    events.clear()
    port.verify_pass = True
    run2 = port.run_draft(
        "app-1", _actor(), {"query": "y"}, events.append, session_id="session-1", test_input_id="test-1"
    )

    assert run2.status == "succeeded"
    assert len(events) == 2


# ---- graph primitives (C-1 structural fingerprint) -------------------------


def test_fake_build_dify_port_apply_repair_sets_structure_fingerprint() -> None:
    from core.dify_builder import node_defaults
    from services.dify_builder.graph_ops import structural_fingerprint
    from tests.unit_tests.core.dify_builder.fakes import BuiltinNodeTypes, FakeBuildDifyPort

    port = FakeBuildDifyPort()
    # Build a single Start node via the same verb Build uses.
    intent = MutationIntent(
        op="create_node",
        args={
            "node_type": BuiltinNodeTypes.START,
            "config": node_defaults.default_config(BuiltinNodeTypes.START),
            "node_id": "start",
        },
    )
    result = port.apply_repair("app", _actor(), [intent])
    assert result.structure_fingerprint == structural_fingerprint(port.graph)
    assert result.structure_fingerprint != ""


def test_fake_build_dify_port_run_draft_pass_and_fail() -> None:
    from core.dify_builder.models import NodeEvent
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    events = []
    port = FakeBuildDifyPort()
    actor = Actor(account_id="a", tenant_id="t")
    run = port.run_draft("app", actor, {"q": "x"}, events.append, session_id="session-1", test_input_id="test-1")
    assert run.status == "succeeded"
    assert run.per_node
    assert run.per_node[0].status == "success"
    port.verify_pass = False
    run2 = port.run_draft("app", actor, {"q": "x"}, events.append, session_id="session-1", test_input_id="test-1")
    assert run2.status == "failed"
    assert run2.per_node[0].status == "failed"
    assert run2.per_node[0].error
    assert any(isinstance(e, NodeEvent) for e in events)
