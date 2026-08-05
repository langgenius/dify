from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import AgentBuildSandboxNotFoundError
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


def test_home_snapshot_collection_database_failure_is_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
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
