"""Model-level tests for the workflow copilot persistence tables.

Verifies the 7 copilot tables against an in-memory SQLite engine: default
values (`id`, `version`, timestamps) populate on flush, and the
`(session_id, seq)` uniqueness on conversation items is a real DB constraint.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.base import Base
from models.workflow_copilot import (
    CopilotCheckpoint,
    CopilotConversationItem,
    CopilotRun,
    CopilotSession,
    CopilotSessionCommit,
    CopilotSnapshot,
    CopilotTestInput,
)

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
def session(engine: Engine) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def _make_session(**overrides) -> CopilotSession:
    kwargs = {
        "app_id": APP_ID,
        "tenant_id": TENANT_ID,
        "owner_account_id": ACCOUNT_ID,
        "entry_mode": "chat",
        "current_state": "idle",
    }
    kwargs.update(overrides)
    return CopilotSession(**kwargs)


def test_copilot_session_defaults_populate_on_flush(session: Session) -> None:
    copilot_session = _make_session()

    session.add(copilot_session)
    session.flush()
    session.refresh(copilot_session)

    assert copilot_session.id
    assert copilot_session.version == 1
    assert copilot_session.created_at is not None
    assert copilot_session.updated_at is not None


def test_conversation_item_duplicate_seq_raises_integrity_error(session: Session) -> None:
    copilot_session = _make_session()
    session.add(copilot_session)
    session.flush()

    session.add_all(
        [
            CopilotConversationItem(
                session_id=copilot_session.id,
                seq=1,
                kind="user_message",
                payload={"text": "hello"},
                at_version=1,
            ),
            CopilotConversationItem(
                session_id=copilot_session.id,
                seq=2,
                kind="agent_message",
                payload={"text": "hi"},
                at_version=1,
            ),
        ]
    )
    session.flush()

    session.add(
        CopilotConversationItem(
            session_id=copilot_session.id,
            seq=1,
            kind="user_message",
            payload={"text": "duplicate"},
            at_version=1,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()


def test_session_commit_round_trips_context(session: Session) -> None:
    copilot_session = _make_session()
    session.add(copilot_session)
    session.flush()

    commit = CopilotSessionCommit(
        session_id=copilot_session.id,
        version=1,
        state="idle",
        context={"diagnosis": None, "staged_repair": []},
        actor="system",
    )
    session.add(commit)
    session.flush()
    session.refresh(commit)

    assert commit.id
    assert commit.context == {"diagnosis": None, "staged_repair": []}
    assert commit.created_at is not None


def test_snapshot_and_checkpoint_round_trip(session: Session) -> None:
    copilot_session = _make_session()
    session.add(copilot_session)
    session.flush()

    snapshot = CopilotSnapshot(
        session_id=copilot_session.id,
        hash="deadbeef",
        graph={"nodes": [], "edges": []},
    )
    session.add(snapshot)
    session.flush()
    session.refresh(snapshot)

    checkpoint = CopilotCheckpoint(
        session_id=copilot_session.id,
        state="verified",
        snapshot_id=snapshot.id,
    )
    session.add(checkpoint)
    session.flush()
    session.refresh(checkpoint)

    assert snapshot.id
    assert checkpoint.id
    assert checkpoint.snapshot_id == snapshot.id


def test_run_and_test_input_round_trip(session: Session) -> None:
    copilot_session = _make_session()
    session.add(copilot_session)
    session.flush()

    run = CopilotRun(
        session_id=copilot_session.id,
        kind="verify",
        dify_run_id="run-123",
        status="succeeded",
        per_node={"node-1": "ok"},
        culprit_node_id=None,
        inputs_ref="ref-1",
        tokens=42,
        elapsed_ms=1000,
        immutable=True,
    )
    test_input = CopilotTestInput(
        session_id=copilot_session.id,
        source="user",
        inputs={"query": "hi"},
        start_schema_hash="hash-1",
    )
    session.add_all([run, test_input])
    session.flush()
    session.refresh(run)
    session.refresh(test_input)

    assert run.id
    assert run.immutable is True
    assert test_input.id
