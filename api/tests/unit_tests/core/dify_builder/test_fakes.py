"""Exercise the in-memory repository guarantees relied on by state-machine tests."""

from dataclasses import replace
from typing import Unpack

import pytest

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import (
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
)
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository, SessionOverrides


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


# ---- runs: save/get round trip + immutability ------------------------------


def test_save_run_rejects_overwriting_an_immutable_run() -> None:
    repo = InMemoryRepository()
    r = Run(id="TR-1", kind="original-failed", status="failed", immutable=True)
    repo.save_run("sess-1", r)

    with pytest.raises(ValueError, match="immutable"):
        repo.save_run("sess-1", Run(id="TR-1", status="succeeded"))


# ---- graph primitives (C-1 structural fingerprint) -------------------------


def test_workflow_writer_fake_preserves_scope_expiry_and_token_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.core.dify_builder import fakes

    monkeypatch.setattr(fakes, "monotonic", lambda: 100.0)
    repo = InMemoryRepository()
    first, replacement, independent = _session(), _session(), _session(app_id="other-app")
    for session in (first, replacement, independent):
        repo.create_session(session, DifyBuilderContext(), [])
    assert repo.reserve_workflow_writer(first.id, "old-token", 0, 600)
    assert not repo.reserve_workflow_writer(replacement.id, "new-token", 0, 600)
    assert repo.reserve_workflow_writer(independent.id, "independent-token", 0, 600)
    assert not repo.activate_workflow_writer(first.id, "wrong-token", 1200)
    assert repo.activate_workflow_writer(first.id, "old-token", 1200)

    monkeypatch.setattr(fakes, "monotonic", lambda: 1000.0)
    assert repo.is_task_active(first.id, 0, "old-token")
    monkeypatch.setattr(fakes, "monotonic", lambda: 1400.0)
    assert not repo.is_task_active(first.id, 0, "old-token")
    assert repo.reserve_workflow_writer(replacement.id, "new-token", 0, 600)
    repo.release_workflow_writer(first.id, token="old-token")
    assert repo.is_task_active(replacement.id, 0, "new-token")
