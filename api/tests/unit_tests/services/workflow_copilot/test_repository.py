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
from core.workflow_copilot.models import ConversationItem, EntryMode, FixContext, MutationIntent
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
    fc = FixContext(failed_run_id="TR-1")
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
    assert loaded_fc == FixContext(failed_run_id="TR-1", next_seq=2)


def test_get_session_missing_id_raises_not_found(repo: SqlCopilotRepository) -> None:
    with pytest.raises(NotFoundError):
        repo.get_session("does-not-exist")


def test_compare_and_advance_bumps_version_and_appends_commit_and_items(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = FixContext(failed_run_id="TR-1")
    repo.create_session(domain_session, fc, [])

    next_fc = FixContext(failed_run_id="TR-1", staged_repair=[MutationIntent(op="set_node_config")])
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
    fc = FixContext(failed_run_id="TR-1")
    repo.create_session(domain_session, fc, [])

    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            domain_session.id,
            base_version=999,
            next=PcState.FIX_PROPOSE,
            fc=FixContext(),
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
            fc=FixContext(),
            items=[],
        )


def test_compare_and_advance_duplicate_seq_raises_conflict(repo: SqlCopilotRepository) -> None:
    domain_session = _make_domain_session()
    fc = FixContext(failed_run_id="TR-1")
    seed_items = [ConversationItem(seq=0, kind="run-context", payload={}, at_version=1)]
    repo.create_session(domain_session, fc, seed_items)

    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            domain_session.id,
            base_version=1,
            next=PcState.FIX_PROPOSE,
            fc=FixContext(),
            items=[ConversationItem(seq=0, kind="diagnosis", payload={}, at_version=2)],
        )

    # The row must not have advanced -- the whole call is one transaction.
    loaded_session, _ = repo.get_session(domain_session.id)
    assert loaded_session.version == 1
    assert loaded_session.current_state == PcState.FIX_DIAGNOSE
