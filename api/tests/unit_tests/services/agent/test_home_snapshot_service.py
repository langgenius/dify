from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dify_agent.client import DifyAgentHTTPError, DifyAgentNotFoundError, DifyAgentTimeoutError
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import (
    AgentBuildSandboxNotFoundError,
    AgentHomeSnapshotCreateFailedError,
    AgentHomeSnapshotTooLargeError,
)
from services.agent.home_snapshot_service import AgentHomeSnapshotService, validate_home_snapshot_binding
from services.agent.workspace_service import AgentWorkspaceBindingGenerationMismatchError
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


def _client(*, snapshot_ref: str = "snapshot-ref-1") -> MagicMock:
    client = MagicMock()
    client.create_home_snapshot_from_binding_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    return client


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


def _persist_build_binding(
    session: Session,
    *,
    app_id: str,
    backing_app_id: str | None,
    base_home_snapshot_id: str | None = "home-old",
    agent_config_version_id: str = "build-1",
    agent_config_version_kind: AgentConfigVersionKind = AgentConfigVersionKind.BUILD_DRAFT,
) -> None:
    runtime_app_id = backing_app_id or app_id
    session.add_all(
        [
            Agent(
                id="agent-1",
                tenant_id="tenant-1",
                name="Builder",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                status=AgentStatus.ACTIVE,
                app_id=app_id,
                backing_app_id=backing_app_id,
            ),
            AgentWorkspace(
                id="workspace-1",
                tenant_id="tenant-1",
                app_id=runtime_app_id,
                owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                owner_id="build-1",
                owner_scope_key="root",
                backend_workspace_ref="workspace-ref-1",
                status=AgentWorkingResourceStatus.ACTIVE,
            ),
            AgentWorkspaceBinding(
                id="binding-1",
                tenant_id="tenant-1",
                app_id=runtime_app_id,
                workspace_id="workspace-1",
                agent_id="agent-1",
                base_home_snapshot_id=base_home_snapshot_id,
                agent_config_version_id=agent_config_version_id,
                agent_config_version_kind=agent_config_version_kind,
                backend_binding_ref="binding-ref-1",
                status=AgentWorkingResourceStatus.ACTIVE,
            ),
        ]
    )
    session.commit()


@pytest.mark.parametrize(
    ("app_id", "backing_app_id", "expected_runtime_app_id"),
    [
        ("app-1", None, "app-1"),
        ("workflow-app-1", "runtime-app-1", "runtime-app-1"),
    ],
)
def test_build_apply_checkpoints_exact_active_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    app_id: str,
    backing_app_id: str | None,
    expected_runtime_app_id: str,
) -> None:
    _persist_build_binding(sqlite_session, app_id=app_id, backing_app_id=backing_app_id)
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=sqlite_session,
        build_draft=_build_draft(),
    )
    sqlite_session.flush()

    stored = sqlite_session.scalar(select(AgentHomeSnapshot).where(AgentHomeSnapshot.id == snapshot.id))
    assert stored is snapshot
    request = client.create_home_snapshot_from_binding_sync.call_args.args[0]
    assert request.tenant_id == "tenant-1"
    assert request.agent_id == "agent-1"
    assert request.backend_binding_ref == "binding-ref-1"
    assert snapshot.snapshot_ref == "snapshot-ref-2"
    workspace = sqlite_session.get(AgentWorkspace, "workspace-1")
    assert workspace is not None
    assert workspace.app_id == expected_runtime_app_id


def test_build_apply_forwards_default_home_generation(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    _persist_build_binding(sqlite_session, app_id="app-1", backing_app_id=None, base_home_snapshot_id=None)
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=sqlite_session,
        build_draft=_build_draft(home_snapshot_id=None),
    )
    sqlite_session.flush()

    assert snapshot.snapshot_ref == "snapshot-ref-2"
    assert sqlite_session.get(AgentHomeSnapshot, snapshot.id) is snapshot


@pytest.mark.parametrize(
    ("base_home_snapshot_id", "agent_config_version_id", "agent_config_version_kind"),
    [
        (None, "build-1", AgentConfigVersionKind.BUILD_DRAFT),
        ("home-old", "build-2", AgentConfigVersionKind.BUILD_DRAFT),
        ("home-old", "build-1", AgentConfigVersionKind.SNAPSHOT),
    ],
)
def test_build_apply_rejects_binding_from_a_different_generation(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    base_home_snapshot_id: str | None,
    agent_config_version_id: str,
    agent_config_version_kind: AgentConfigVersionKind,
) -> None:
    _persist_build_binding(
        sqlite_session,
        app_id="app-1",
        backing_app_id=None,
        base_home_snapshot_id=base_home_snapshot_id,
        agent_config_version_id=agent_config_version_id,
        agent_config_version_kind=agent_config_version_kind,
    )
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    with pytest.raises(AgentWorkspaceBindingGenerationMismatchError):
        AgentHomeSnapshotService.create_for_build_apply(
            session=sqlite_session,
            build_draft=_build_draft(),
        )

    client.create_home_snapshot_from_binding_sync.assert_not_called()


def test_build_apply_fails_fast_without_source_binding(unbound_session: Session) -> None:
    build_draft = _build_draft()
    build_draft.agent_workspace_binding_id = None

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentHomeSnapshotService.create_for_build_apply(
            session=unbound_session,
            build_draft=build_draft,
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


def _apply_with_client_error(monkeypatch: pytest.MonkeyPatch, session: Session, error: Exception) -> None:
    _persist_build_binding(session, app_id="app-1", backing_app_id=None)
    client = MagicMock()
    client.create_home_snapshot_from_binding_sync.side_effect = error
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    AgentHomeSnapshotService.create_for_build_apply(session=session, build_draft=_build_draft())


def test_build_apply_surfaces_the_backend_message(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    error = DifyAgentHTTPError(
        status_code=502,
        detail={
            "code": "home_snapshot_create_failed",
            "message": "500 snapshot_save_failed: object store unavailable",
        },
    )

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, sqlite_session, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "500 snapshot_save_failed: object store unavailable",
        "status": 502,
    }


def test_build_apply_maps_a_too_large_snapshot_to_413(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    error = DifyAgentHTTPError(
        status_code=413,
        detail={
            "code": "home_snapshot_too_large",
            "message": "home snapshot exceeds the configured limit of 67108864 bytes",
        },
    )

    with pytest.raises(AgentHomeSnapshotTooLargeError) as excinfo:
        _apply_with_client_error(monkeypatch, sqlite_session, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_too_large",
        "message": "home snapshot exceeds the configured limit of 67108864 bytes",
        "status": 413,
    }


def test_build_apply_surfaces_a_non_dict_backend_detail(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    error = DifyAgentHTTPError(status_code=500, detail="upstream exploded")

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, sqlite_session, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "upstream exploded",
        "status": 502,
    }


def test_build_apply_surfaces_a_transport_failure(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    error = DifyAgentTimeoutError("read timed out after 45.0s")

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, sqlite_session, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "read timed out after 45.0s",
        "status": 502,
    }


def test_build_apply_still_maps_404_to_a_missing_sandbox(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    error = DifyAgentNotFoundError(status_code=404, detail={"code": "binding_lost", "message": "gone"})

    with pytest.raises(AgentBuildSandboxNotFoundError):
        _apply_with_client_error(monkeypatch, sqlite_session, error)
