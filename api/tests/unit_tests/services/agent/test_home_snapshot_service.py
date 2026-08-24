from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dify_agent.client import DifyAgentHTTPError, DifyAgentNotFoundError, DifyAgentTimeoutError
from sqlalchemy.orm import Session

from configs import dify_config
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import (
    AgentBuildSandboxNotFoundError,
    AgentHomeSnapshotCreateFailedError,
    AgentHomeSnapshotTooLargeError,
)
from services.agent.home_snapshot_service import AgentHomeSnapshotService, validate_home_snapshot_binding
from services.agent.workspace_service import AgentWorkspaceService


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
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BASE_URL", "http://agent.example")

    client = AgentHomeSnapshotService._client()

    assert client._timeout == 45.0


def test_validate_home_snapshot_binding_accepts_default_home_without_ledger_lookup() -> None:
    session = MagicMock()
    validate_home_snapshot_binding(
        session=session,
        agent=Agent(id="agent-1"),
        home_snapshot_id=None,
    )

    session.scalar.assert_not_called()


@pytest.mark.parametrize(
    ("app_id", "backing_app_id", "expected_runtime_app_id"),
    [
        ("app-1", None, "app-1"),
        ("workflow-app-1", "runtime-app-1", "runtime-app-1"),
    ],
)
def test_build_apply_checkpoints_exact_active_binding(
    monkeypatch: pytest.MonkeyPatch,
    app_id: str,
    backing_app_id: str | None,
    expected_runtime_app_id: str,
) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(app_id=app_id, backing_app_id=backing_app_id)
    binding = SimpleNamespace(
        backend_binding_ref="binding-ref-1",
        agent_id="agent-1",
        base_home_snapshot_id="home-old",
        agent_config_version_id="build-1",
        agent_config_version_kind="build_draft",
    )
    get_binding = MagicMock(return_value=binding)
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    validate_generation = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=session,
        build_draft=_build_draft(),
    )

    assert get_binding.call_args.kwargs["binding_id"] == "binding-1"
    assert get_binding.call_args.kwargs["expected_owner_scope"].app_id == expected_runtime_app_id
    request = client.create_home_snapshot_from_binding_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-ref-1"
    assert snapshot.snapshot_ref == "snapshot-ref-2"
    assert validate_generation.call_args.kwargs["base_home_snapshot_id"] == "home-old"


def test_build_apply_forwards_default_home_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(app_id="app-1", backing_app_id=None)
    binding = SimpleNamespace(
        backend_binding_ref="binding-ref-1",
        agent_id="agent-1",
        base_home_snapshot_id=None,
        agent_config_version_id="build-1",
        agent_config_version_kind="build_draft",
    )
    client = _client(snapshot_ref="snapshot-ref-2")
    validate_generation = MagicMock()
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=session,
        build_draft=_build_draft(home_snapshot_id=None),
    )

    assert snapshot.snapshot_ref == "snapshot-ref-2"
    assert validate_generation.call_args.kwargs["base_home_snapshot_id"] is None


def test_build_apply_fails_fast_without_source_binding() -> None:
    session = MagicMock()
    build_draft = _build_draft()
    build_draft.agent_workspace_binding_id = None

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentHomeSnapshotService.create_for_build_apply(
            session=session,
            build_draft=build_draft,
        )


def test_home_snapshot_collection_database_failure_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    error = RuntimeError("database unavailable")
    session.scalar.side_effect = error
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: context,
    )

    with pytest.raises(RuntimeError) as exc_info:
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id="tenant-1",
            home_snapshot_id="home-1",
        )

    assert exc_info.value is error


@pytest.mark.parametrize("snapshot_state", ["missing", "active"])
@pytest.mark.parametrize("sqlite_session", [(AgentHomeSnapshot,)], indirect=True)
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
    commit = MagicMock(wraps=sqlite_session.commit)
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)
    monkeypatch.setattr(sqlite_session, "commit", commit)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    delete.assert_not_called()
    commit.assert_not_called()


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentConfigDraft, AgentConfigSnapshot)],
    indirect=True,
)
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


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentConfigDraft, AgentConfigSnapshot)],
    indirect=True,
)
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


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentConfigDraft, AgentConfigSnapshot)],
    indirect=True,
)
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
    error = RuntimeError("database unavailable")
    commit = MagicMock(side_effect=error)
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(sqlite_session, "commit", commit)
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    with pytest.raises(RuntimeError) as exc_info:
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id="tenant-1",
            home_snapshot_id="home-1",
        )

    assert exc_info.value is error
    delete.assert_called_once_with(snapshot_ref="snapshot-ref-1")


def _apply_with_client_error(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(app_id="app-1", backing_app_id=None)
    binding = SimpleNamespace(
        backend_binding_ref="binding-ref-1",
        agent_id="agent-1",
        base_home_snapshot_id="home-old",
        agent_config_version_id="build-1",
        agent_config_version_kind="build_draft",
    )
    client = MagicMock()
    client.create_home_snapshot_from_binding_sync.side_effect = error
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", MagicMock())

    AgentHomeSnapshotService.create_for_build_apply(session=session, build_draft=_build_draft())


def test_build_apply_surfaces_the_backend_message(monkeypatch: pytest.MonkeyPatch) -> None:
    error = DifyAgentHTTPError(
        status_code=502,
        detail={
            "code": "home_snapshot_create_failed",
            "message": "500 snapshot_save_failed: object store unavailable",
        },
    )

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "500 snapshot_save_failed: object store unavailable",
        "status": 502,
    }


def test_build_apply_maps_a_too_large_snapshot_to_413(monkeypatch: pytest.MonkeyPatch) -> None:
    error = DifyAgentHTTPError(
        status_code=413,
        detail={
            "code": "home_snapshot_too_large",
            "message": "home snapshot exceeds the configured limit of 67108864 bytes",
        },
    )

    with pytest.raises(AgentHomeSnapshotTooLargeError) as excinfo:
        _apply_with_client_error(monkeypatch, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_too_large",
        "message": "home snapshot exceeds the configured limit of 67108864 bytes",
        "status": 413,
    }


def test_build_apply_surfaces_a_non_dict_backend_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    error = DifyAgentHTTPError(status_code=500, detail="upstream exploded")

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "upstream exploded",
        "status": 502,
    }


def test_build_apply_surfaces_a_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    error = DifyAgentTimeoutError("read timed out after 45.0s")

    with pytest.raises(AgentHomeSnapshotCreateFailedError) as excinfo:
        _apply_with_client_error(monkeypatch, error)

    assert excinfo.value.data == {
        "code": "agent_home_snapshot_create_failed",
        "message": "read timed out after 45.0s",
        "status": 502,
    }


def test_build_apply_still_maps_404_to_a_missing_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    error = DifyAgentNotFoundError(status_code=404, detail={"code": "binding_lost", "message": "gone"})

    with pytest.raises(AgentBuildSandboxNotFoundError):
        _apply_with_client_error(monkeypatch, error)
