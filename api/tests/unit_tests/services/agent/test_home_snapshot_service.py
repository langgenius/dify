from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import AgentBuildSandboxNotFoundError
from services.agent.home_snapshot_service import AgentHomeSnapshotService


def _build_draft() -> AgentConfigDraft:
    return AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )


def _client(*, snapshot_ref: str = "snapshot-ref-1") -> MagicMock:
    client = MagicMock()
    client.initialize_home_snapshot_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    client.create_home_snapshot_from_binding_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    return client


def test_create_initial_persists_backend_snapshot_ref(monkeypatch) -> None:
    session = MagicMock()
    client = _client()
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_initial(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )

    assert snapshot.snapshot_ref == "snapshot-ref-1"
    assert snapshot.status is AgentWorkingResourceStatus.ACTIVE
    session.add.assert_called_once_with(snapshot)
    session.flush.assert_called_once_with()


def test_create_initial_flush_failure_does_not_delete_backend_snapshot(monkeypatch) -> None:
    session = MagicMock()
    session.flush.side_effect = RuntimeError("flush failed")
    client = _client()
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    with pytest.raises(RuntimeError, match="flush failed"):
        AgentHomeSnapshotService.create_initial(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )

    client.delete_home_snapshot_sync.assert_not_called()


def test_build_apply_checkpoints_exact_active_binding(monkeypatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(backend_binding_ref="binding-ref-1")
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=session,
        build_draft=_build_draft(),
        source_binding_id="binding-1",
    )

    request = client.create_home_snapshot_from_binding_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-ref-1"
    assert snapshot.snapshot_ref == "snapshot-ref-2"


def test_build_apply_fails_fast_without_source_binding() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentHomeSnapshotService.create_for_build_apply(
            session=session,
            build_draft=_build_draft(),
            source_binding_id="missing-binding",
        )


def test_home_snapshot_collection_database_failure_is_best_effort(monkeypatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalar.side_effect = RuntimeError("database unavailable")
    log_exception = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr("services.agent.home_snapshot_service.logger.exception", log_exception)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    session.scalar.assert_called_once()
    log_exception.assert_called_once_with(
        "Failed to collect retired Agent Home Snapshot",
        extra={"tenant_id": "tenant-1", "home_snapshot_id": "home-1"},
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentConfigDraft, AgentConfigSnapshot)],
    indirect=True,
)
def test_home_snapshot_collection_final_delete_failure_is_best_effort(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    snapshot = AgentHomeSnapshot(
        id="home-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_ref="snapshot-ref-1",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    sqlite_session.add(snapshot)
    sqlite_session.commit()
    commit = MagicMock(side_effect=RuntimeError("database unavailable"))
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(sqlite_session, "commit", commit)
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    delete.assert_called_once_with(snapshot_ref="snapshot-ref-1")
