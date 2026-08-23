"""Tests for ``SqlCopilotRepository``'s session lifecycle + version-CAS.

Verifies the P3a Task 4 slice (``create_session``/``get_session``/
``compare_and_advance``) against an in-memory SQLite database: real
``Base.metadata.create_all`` DDL, a real ``UPDATE ... WHERE version=`` CAS,
and a real ``UNIQUE(session_id, seq)`` constraint backing seq authority.
The remaining ``Repository`` methods (checkpoints/runs/test-inputs/
list_conversation) are Task 5 and are not exercised here.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.errors import ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Checkpoint,
    ConversationItem,
    CopilotContext,
    EntryMode,
    MutationIntent,
    NodeOutput,
    Run,
    Snapshot,
    TestInput,
)
from core.workflow_copilot.models import Session as DomainSession
from core.workflow_copilot.state import PcState
from models.base import Base
from services.workflow_copilot.repository import SqlCopilotRepository

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repo(engine: Engine) -> SqlCopilotRepository:
    factory = sessionmaker(bind=engine)
    return SqlCopilotRepository(factory)


def _make_domain_session(**overrides) -> DomainSession:
    kwargs = {
        "app_id": APP_ID,
        "tenant_id": TENANT_ID,
        "owner_account_id": ACCOUNT_ID,
        "entry_mode": EntryMode.FIX,
        "current_state": PcState.FIX_DIAGNOSE,
    }
    kwargs.update(overrides)
    return DomainSession(**kwargs)


def test_create_session_then_get_session_round_trips(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    items = [
        ConversationItem(seq=0, kind="run-context", payload={"a": 1}, at_version=1),
        ConversationItem(seq=1, kind="assistant-turn", payload={"b": 2}, at_version=1),
    ]

    repo.create_session(domain_session, fc, items)

    # id was generated + version defaults to 1.
    assert domain_session.id
    assert domain_session.version == 1
    # next_seq advances past the seeded items.
    assert fc.next_seq == 2

    loaded_session, loaded_fc = repo.get_session(domain_session.id)

    assert loaded_session.id == domain_session.id
    assert loaded_session.app_id == APP_ID
    assert loaded_session.tenant_id == TENANT_ID
    assert loaded_session.owner_account_id == ACCOUNT_ID
    assert loaded_session.entry_mode == EntryMode.FIX
    assert loaded_session.current_state == PcState.FIX_DIAGNOSE
    assert loaded_session.version == 1
    assert loaded_fc == CopilotContext(failed_run_id="TR-1", next_seq=2)


def test_get_session_missing_id_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.get_session("does-not-exist")


def test_compare_and_advance_bumps_version_and_appends_commit_and_items(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    repo.create_session(domain_session, fc, [])

    next_fc = CopilotContext(failed_run_id="TR-1", staged_repair=[MutationIntent(op="set_node_config")])
    new_items = [ConversationItem(seq=0, kind="diagnosis", payload={"x": 1}, at_version=2)]

    new_version = repo.compare_and_advance(
        domain_session.id, base_version=1, next=PcState.FIX_PROPOSE, fc=next_fc, items=new_items
    )

    assert new_version == 2

    loaded_session, loaded_fc = repo.get_session(domain_session.id)
    assert loaded_session.version == 2
    assert loaded_session.current_state == PcState.FIX_PROPOSE
    assert loaded_fc == next_fc


def test_compare_and_advance_stale_version_raises_conflict_and_leaves_row_unchanged(
    repo: SqlCopilotRepository,
) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    repo.create_session(domain_session, fc, [])

    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            domain_session.id,
            base_version=999,
            next=PcState.FIX_PROPOSE,
            fc=CopilotContext(),
            items=[],
        )

    loaded_session, loaded_fc = repo.get_session(domain_session.id)
    assert loaded_session.version == 1
    assert loaded_session.current_state == PcState.FIX_DIAGNOSE
    assert loaded_fc == fc


def test_compare_and_advance_missing_session_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.compare_and_advance(
            "does-not-exist",
            base_version=1,
            next=PcState.FIX_PROPOSE,
            fc=CopilotContext(),
            items=[],
        )


def test_compare_and_advance_duplicate_seq_raises_conflict(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    seed_items = [ConversationItem(seq=0, kind="run-context", payload={}, at_version=1)]
    repo.create_session(domain_session, fc, seed_items)

    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            domain_session.id,
            base_version=1,
            next=PcState.FIX_PROPOSE,
            fc=CopilotContext(),
            items=[ConversationItem(seq=0, kind="diagnosis", payload={}, at_version=2)],
        )

    # The row must not have advanced -- the whole call is one transaction.
    loaded_session, _ = repo.get_session(domain_session.id)
    assert loaded_session.version == 1
    assert loaded_session.current_state == PcState.FIX_DIAGNOSE


# -- checkpoints (P3a Task 5) --


def test_create_checkpoint_then_get_checkpoint_round_trips(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    repo.create_session(domain_session, fc, [])

    snap = Snapshot(session_id=domain_session.id, hash="h1", graph={"nodes": [1, 2, 3]})
    cp = Checkpoint(session_id=domain_session.id, state=PcState.FIX_DIAGNOSE)

    repo.create_checkpoint(cp, snap)

    assert snap.id
    assert cp.id
    assert cp.snapshot_id == snap.id

    loaded_cp, loaded_snap = repo.get_checkpoint(cp.id)

    assert loaded_cp.id == cp.id
    assert loaded_cp.session_id == domain_session.id
    assert loaded_cp.state == PcState.FIX_DIAGNOSE
    assert loaded_cp.snapshot_id == snap.id
    assert loaded_snap.id == snap.id
    assert loaded_snap.session_id == domain_session.id
    assert loaded_snap.hash == "h1"
    assert loaded_snap.graph == {"nodes": [1, 2, 3]}


def test_get_checkpoint_missing_id_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.get_checkpoint("does-not-exist")


# -- runs (P3a Task 5) --


def test_save_run_with_preset_id_preserves_it_and_get_run_round_trips(repo: SqlCopilotRepository) -> None:
    run = Run(
        id="44444444-4444-4444-4444-444444444444",
        kind="verify",
        dify_run_id="dr-1",
        status="succeeded",
        per_node=[NodeOutput(node_id="n1", title="Node 1", status="success", outputs={"x": 1})],
        culprit_node_id="",
        inputs_ref="ir-1",
        tokens=42,
        elapsed_ms=1234,
        immutable=True,
    )

    repo.save_run("session-1", run)

    assert run.id == "44444444-4444-4444-4444-444444444444"

    loaded = repo.get_run(run.id)

    assert loaded.id == run.id
    assert loaded.kind == "verify"
    assert loaded.dify_run_id == "dr-1"
    assert loaded.status == "succeeded"
    assert loaded.immutable is True
    assert loaded.per_node == [NodeOutput(node_id="n1", title="Node 1", status="success", outputs={"x": 1})]
    assert loaded.tokens == 42
    assert loaded.elapsed_ms == 1234


def test_save_run_with_empty_id_generates_one(repo: SqlCopilotRepository) -> None:
    run = Run(kind="original-failed", status="failed")

    repo.save_run("session-1", run)

    assert run.id
    loaded = repo.get_run(run.id)
    assert loaded.id == run.id


def test_get_run_missing_id_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.get_run("does-not-exist")


# -- test inputs (P3a Task 5) --


def test_save_test_input_then_get_test_input_round_trips(repo: SqlCopilotRepository) -> None:
    ti = TestInput(session_id="session-1", source="mock", inputs={"q": "hi"}, start_schema_hash="hash-1")

    repo.save_test_input(ti)

    assert ti.id
    loaded = repo.get_test_input(ti.id)

    assert loaded.id == ti.id
    assert loaded.session_id == "session-1"
    assert loaded.source == "mock"
    assert loaded.inputs == {"q": "hi"}
    assert loaded.start_schema_hash == "hash-1"


def test_save_test_input_with_preset_id_preserves_it(repo: SqlCopilotRepository) -> None:
    ti = TestInput(id="55555555-5555-5555-5555-555555555555", session_id="session-1", source="upload")

    repo.save_test_input(ti)

    assert ti.id == "55555555-5555-5555-5555-555555555555"


def test_get_test_input_missing_id_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.get_test_input("does-not-exist")


# -- conversation (P3a Task 5) --


def test_list_conversation_returns_items_ordered_by_seq(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = CopilotContext(failed_run_id="TR-1")
    items = [
        ConversationItem(seq=0, kind="run-context", payload={"a": 1}, at_version=1),
        ConversationItem(seq=1, kind="assistant-turn", payload={"b": 2}, at_version=1),
    ]
    repo.create_session(domain_session, fc, items)

    more_items = [ConversationItem(seq=2, kind="diagnosis", payload={"c": 3}, at_version=2)]
    repo.compare_and_advance(
        domain_session.id, base_version=1, next=PcState.FIX_PROPOSE, fc=CopilotContext(), items=more_items
    )

    conv = repo.list_conversation(domain_session.id)

    assert [item.seq for item in conv] == [0, 1, 2]
    assert conv[0].kind == "run-context"
    assert conv[0].payload == {"a": 1}
    assert conv[2].kind == "diagnosis"


def test_list_conversation_empty_for_unknown_session(repo: SqlCopilotRepository) -> None:
    assert repo.list_conversation("does-not-exist") == []
