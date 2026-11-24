from contextlib import nullcontext
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.home_snapshot_service import AgentHomeSnapshotService, validate_home_snapshot_binding
from tests.helpers.unit.config_override import apply_config_overrides


def _build_draft(*, home_snapshot_id: str | None = "home-old") -> AgentConfigDraft:
    return AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id=home_snapshot_id,
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )


def test_home_snapshot_client_outlasts_the_gateway_snapshot_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_BASE_URL="http://agent.example")

    client = AgentHomeSnapshotService._client()

    assert client._timeout == 45.0


def test_validate_home_snapshot_binding_accepts_default_home_without_ledger_lookup(unbound_session: Session) -> None:
    validate_home_snapshot_binding(
        session=unbound_session,
        agent=Agent(
            tenant_id="tenant-1", name="Agent", scope=AgentScope.ROSTER, source=AgentSource.ROSTER, id="agent-1"
        ),
        home_snapshot_id=None,
    )


def test_home_snapshot_collection_database_failure_propagates(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    sqlite_session.execute(text(f"DROP TABLE {AgentHomeSnapshot.__tablename__}"))
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    with pytest.raises(OperationalError, match="no such table"):
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id="tenant-1",
            home_snapshot_id="home-1",
        )


@pytest.mark.parametrize("snapshot_state", ["missing", "active"])
def test_home_snapshot_collection_non_retired_target_is_idempotent_noop(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    snapshot_state: str,
) -> None:
    if snapshot_state == "active":
        sqlite_session.add(
            AgentHomeSnapshot(
                id="home-1",
                tenant_id="tenant-1",
                agent_id="agent-1",
                snapshot_ref="snapshot-ref-1",
                status=AgentWorkingResourceStatus.ACTIVE,
            )
        )
        sqlite_session.commit()
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    delete.assert_not_called()
    rows = sqlite_session.scalars(select(AgentHomeSnapshot).where(AgentHomeSnapshot.id == "home-1")).all()
    if snapshot_state == "active":
        assert [row.status for row in rows] == [AgentWorkingResourceStatus.ACTIVE]
        assert rows[0].retired_at is None
    else:
        assert rows == []


def test_home_snapshot_collection_backend_failure_propagates_and_preserves_retired_snapshot(
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
    error = RuntimeError("Agent backend unavailable")
    delete = MagicMock(side_effect=error)
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    with pytest.raises(RuntimeError) as exc_info:
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id="tenant-1",
            home_snapshot_id=snapshot.id,
        )

    assert exc_info.value is error
    stored_snapshot = sqlite_session.get(AgentHomeSnapshot, snapshot.id)
    assert stored_snapshot is not None
    assert stored_snapshot.status is AgentWorkingResourceStatus.RETIRED


def test_home_snapshot_collection_ignores_config_references(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    snapshot = AgentHomeSnapshot(
        id="home-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_ref="snapshot-ref-1",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    draft = _build_draft(home_snapshot_id=snapshot.id)
    config_snapshot = AgentConfigSnapshot(
        id="config-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        home_snapshot_id=snapshot.id,
        config_snapshot=AgentSoulConfig(),
    )
    sqlite_session.add_all([snapshot, draft, config_snapshot])
    sqlite_session.commit()
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id=snapshot.id,
    )

    delete.assert_called_once_with(snapshot_ref=snapshot.snapshot_ref)
    assert sqlite_session.get(AgentHomeSnapshot, snapshot.id) is None
    assert sqlite_session.get(AgentConfigDraft, draft.id) is not None
    assert sqlite_session.get(AgentConfigSnapshot, config_snapshot.id) is not None


def test_home_snapshot_collection_final_delete_failure_propagates(
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
    sqlite_session.execute(
        text(
            "CREATE TRIGGER reject_home_snapshot_delete BEFORE DELETE ON agent_home_snapshots "
            "BEGIN SELECT RAISE(ABORT, 'home snapshot delete blocked'); END"
        )
    )
    sqlite_session.commit()
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    with pytest.raises(IntegrityError, match="home snapshot delete blocked"):
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id="tenant-1",
            home_snapshot_id="home-1",
        )

    delete.assert_called_once_with(snapshot_ref="snapshot-ref-1")
    sqlite_session.rollback()
    assert sqlite_session.scalar(select(AgentHomeSnapshot).where(AgentHomeSnapshot.id == "home-1")) is not None
