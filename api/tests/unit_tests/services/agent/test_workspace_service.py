from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope


def _scope() -> WorkspaceOwnerScope:
    return WorkspaceOwnerScope(
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
    )


def _creation_context(*, commit_error: Exception | None = None):
    session = MagicMock()
    session.info = {}

    def scalar(statement):
        entity = statement.column_descriptions[0].get("entity")
        if entity is AgentHomeSnapshot:
            return SimpleNamespace(snapshot_ref="home-ref")
        if entity is AgentWorkspace:
            return None
        raise AssertionError(f"unexpected query entity: {entity}")

    session.scalar.side_effect = scalar
    session.commit.side_effect = commit_error

    context = MagicMock()
    context.__enter__.return_value = session
    return context, session


def _backend_client() -> MagicMock:
    client = MagicMock()
    client.create_execution_binding_sync.return_value = SimpleNamespace(
        binding_ref="binding-ref",
        workspace_ref="workspace-ref",
    )
    return client


def _workspace(
    *,
    workspace_id: str = "workspace-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    owner_type: AgentWorkspaceOwnerType = AgentWorkspaceOwnerType.CONVERSATION,
    owner_id: str = "conversation-1",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
    updated_at: datetime | None = None,
    backend_workspace_ref: str = "workspace-ref",
) -> AgentWorkspace:
    return AgentWorkspace(
        id=workspace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        owner_type=owner_type,
        owner_id=owner_id,
        owner_scope_key="root",
        backend_workspace_ref=backend_workspace_ref,
        status=status,
        active_guard=1 if status is AgentWorkingResourceStatus.ACTIVE else None,
        updated_at=updated_at,
    )


def _binding(
    *,
    binding_id: str = "binding-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    workspace_id: str = "workspace-1",
    agent_id: str = "agent-1",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
    config_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
    updated_at: datetime | None = None,
) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=config_kind,
        backend_binding_ref=f"{binding_id}-ref",
        status=status,
        active_guard=1 if status is AgentWorkingResourceStatus.ACTIVE else None,
        updated_at=updated_at,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_create_binding_success_persists_new_workspace_and_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    sqlite_session.add(
        AgentHomeSnapshot(
            id="home-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            snapshot_ref="home-ref",
            status=AgentWorkingResourceStatus.ACTIVE,
        )
    )
    sqlite_session.commit()
    client = _backend_client()
    monkeypatch.setattr(
        "services.agent.workspace_service.session_factory.create_session", lambda: nullcontext(sqlite_session)
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    binding = AgentWorkspaceService.create_or_resolve_binding(
        scope=_scope(),
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
    )

    workspace = sqlite_session.scalar(select(AgentWorkspace))
    stored_binding = sqlite_session.get(AgentWorkspaceBinding, binding.id)
    assert workspace is not None
    assert stored_binding is not None
    assert binding.workspace_id == workspace.id
    assert stored_binding.backend_binding_ref == "binding-ref"
    request = client.create_execution_binding_sync.call_args.args[0]
    assert request.existing_workspace_ref is None
    assert request.workspace_id == workspace.id


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_create_second_binding_reuses_existing_workspace(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workspace = _workspace()
    first_binding = _binding()
    home = AgentHomeSnapshot(
        id="home-2",
        tenant_id="tenant-1",
        agent_id="agent-2",
        snapshot_ref="home-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([workspace, first_binding, home])
    sqlite_session.commit()
    client = _backend_client()
    monkeypatch.setattr(
        "services.agent.workspace_service.session_factory.create_session", lambda: nullcontext(sqlite_session)
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    binding = AgentWorkspaceService.create_or_resolve_binding(
        scope=_scope(),
        agent_id="agent-2",
        base_home_snapshot_id="home-2",
        agent_config_version_id="config-2",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
    )

    assert binding.workspace_id == workspace.id
    assert sqlite_session.scalars(select(AgentWorkspace)).all() == [workspace]
    assert {row.id for row in sqlite_session.scalars(select(AgentWorkspaceBinding)).all()} == {
        first_binding.id,
        binding.id,
    }
    request = client.create_execution_binding_sync.call_args.args[0]
    assert request.existing_workspace_ref == "workspace-ref"
    assert request.workspace_id == workspace.id


def test_binding_commit_exception_preserves_physical_resource(monkeypatch) -> None:
    context, session = _creation_context(commit_error=RuntimeError("commit failed"))
    client = _backend_client()
    monkeypatch.setattr("services.agent.workspace_service.session_factory.create_session", lambda: context)
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    with pytest.raises(RuntimeError, match="commit failed"):
        AgentWorkspaceService.create_or_resolve_binding(
            scope=_scope(),
            agent_id="agent-1",
            base_home_snapshot_id="home-1",
            agent_config_version_id="config-1",
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )

    client.destroy_execution_binding_sync.assert_not_called()


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_latest_debug_conversation_binding_selects_newest_conversation_or_build_draft(
    sqlite_session: Session,
) -> None:
    older = datetime(2026, 7, 23, 10)
    newer = older + timedelta(minutes=1)
    conversation_workspace = _workspace(workspace_id="workspace-conversation", updated_at=older)
    build_workspace = _workspace(
        workspace_id="workspace-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=newer,
    )
    conversation_binding = _binding(
        binding_id="binding-conversation",
        workspace_id=conversation_workspace.id,
        updated_at=older,
    )
    build_binding = _binding(
        binding_id="binding-build",
        workspace_id=build_workspace.id,
        config_kind=AgentConfigVersionKind.BUILD_DRAFT,
        updated_at=newer,
    )
    sqlite_session.add_all([conversation_workspace, build_workspace, conversation_binding, build_binding])
    sqlite_session.commit()

    resolved = AgentWorkspaceService.resolve_latest_active_conversation_binding(
        session=sqlite_session,
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        include_build_draft=True,
    )

    assert resolved is not None
    assert resolved.id == build_binding.id


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_latest_normal_conversation_binding_excludes_newer_build_draft(sqlite_session: Session) -> None:
    older = datetime(2026, 7, 23, 10)
    newer = older + timedelta(minutes=1)
    conversation_workspace = _workspace(workspace_id="workspace-conversation", updated_at=older)
    build_workspace = _workspace(
        workspace_id="workspace-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=newer,
    )
    conversation_binding = _binding(
        binding_id="binding-conversation",
        workspace_id=conversation_workspace.id,
        updated_at=older,
    )
    build_binding = _binding(
        binding_id="binding-build",
        workspace_id=build_workspace.id,
        config_kind=AgentConfigVersionKind.BUILD_DRAFT,
        updated_at=newer,
    )
    sqlite_session.add_all([conversation_workspace, build_workspace, conversation_binding, build_binding])
    sqlite_session.commit()

    resolved = AgentWorkspaceService.resolve_latest_active_conversation_binding(
        session=sqlite_session,
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id=None,
        include_build_draft=False,
    )

    assert resolved is not None
    assert resolved.id == conversation_binding.id


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_non_final_binding_keeps_workspace_active(sqlite_session: Session) -> None:
    binding = _binding()
    other_binding = _binding(binding_id="binding-2", agent_id="agent-2")
    workspace = _workspace()
    sqlite_session.add_all([workspace, binding, other_binding])
    sqlite_session.commit()

    retired_id = AgentWorkspaceService.retire_binding(
        session=sqlite_session,
        tenant_id="tenant-1",
        binding_id=binding.id,
    )

    assert retired_id == binding.id
    assert binding.status is AgentWorkingResourceStatus.RETIRED
    assert binding.active_guard is None
    assert binding.retired_at is not None
    assert workspace.status is AgentWorkingResourceStatus.ACTIVE
    assert other_binding.status is AgentWorkingResourceStatus.ACTIVE


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_final_binding_retires_workspace(sqlite_session: Session) -> None:
    binding = _binding()
    workspace = _workspace()
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()

    AgentWorkspaceService.retire_binding(session=sqlite_session, tenant_id="tenant-1", binding_id=binding.id)

    assert binding.status is AgentWorkingResourceStatus.RETIRED
    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert workspace.active_guard is None
    assert workspace.retired_at == binding.retired_at


def test_retire_workspace_retires_all_active_bindings() -> None:
    workspace = _workspace()
    bindings = [_binding(), _binding(binding_id="binding-2", agent_id="agent-2")]
    session = MagicMock()
    session.scalar.return_value = workspace
    session.scalars.return_value.all.return_value = bindings

    retired_id = AgentWorkspaceService.retire_workspace(
        session=session,
        tenant_id="tenant-1",
        workspace_id=workspace.id,
    )

    assert retired_id == workspace.id
    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert all(binding.status is AgentWorkingResourceStatus.RETIRED for binding in bindings)
    assert all(binding.active_guard is None for binding in bindings)
    assert all(binding.retired_at == workspace.retired_at for binding in bindings)


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_all_for_app_retires_only_active_workspaces_for_that_app(sqlite_session: Session) -> None:
    active = _workspace(workspace_id="workspace-active", owner_id="conversation-active")
    already_retired = _workspace(
        workspace_id="workspace-retired",
        owner_id="conversation-retired",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    other_app = _workspace(
        workspace_id="workspace-other",
        app_id="app-2",
        owner_id="conversation-other",
    )
    active_binding = _binding(binding_id="binding-active", workspace_id=active.id)
    other_binding = _binding(
        binding_id="binding-other",
        app_id="app-2",
        workspace_id=other_app.id,
    )
    sqlite_session.add_all([active, already_retired, other_app, active_binding, other_binding])
    sqlite_session.commit()

    retired_ids = AgentWorkspaceService.retire_all_for_app(
        session=sqlite_session,
        tenant_id="tenant-1",
        app_id="app-1",
    )

    assert retired_ids == [active.id]
    assert active.status is AgentWorkingResourceStatus.RETIRED
    assert active_binding.status is AgentWorkingResourceStatus.RETIRED
    assert already_retired.status is AgentWorkingResourceStatus.RETIRED
    assert other_app.status is AgentWorkingResourceStatus.ACTIVE
    assert other_binding.status is AgentWorkingResourceStatus.ACTIVE


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_collect_binding_without_retired_workspace_destroys_binding_only(monkeypatch, sqlite_session: Session) -> None:
    binding = _binding(status=AgentWorkingResourceStatus.RETIRED)
    workspace = _workspace()
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    client = MagicMock()
    monkeypatch.setattr(
        "services.agent.workspace_service.session_factory.create_session", lambda: nullcontext(sqlite_session)
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    AgentWorkspaceService.collect_retired_binding(tenant_id="tenant-1", binding_id=binding.id)

    request = client.destroy_execution_binding_sync.call_args.args[0]
    assert request.binding_ref == binding.backend_binding_ref
    assert request.destroy_workspace is False
    assert request.workspace_ref is None
    assert sqlite_session.get(AgentWorkspaceBinding, binding.id) is None
    assert sqlite_session.get(AgentWorkspace, workspace.id) is not None


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_collect_workspace_destroys_workspace_then_remaining_bindings(monkeypatch, sqlite_session: Session) -> None:
    workspace = _workspace(status=AgentWorkingResourceStatus.RETIRED)
    anchor = _binding(status=AgentWorkingResourceStatus.RETIRED)
    remaining = _binding(
        binding_id="binding-2",
        agent_id="agent-2",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    anchor.created_at = datetime(2026, 7, 23, 10)
    remaining.created_at = anchor.created_at + timedelta(minutes=1)
    sqlite_session.add_all([workspace, anchor, remaining])
    sqlite_session.commit()
    client = MagicMock()
    monkeypatch.setattr(
        "services.agent.workspace_service.session_factory.create_session", lambda: nullcontext(sqlite_session)
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    AgentWorkspaceService.collect_retired_workspace(tenant_id="tenant-1", workspace_id=workspace.id)

    requests = [call.args[0] for call in client.destroy_execution_binding_sync.call_args_list]
    assert len(requests) == 2
    assert requests[0].binding_ref == anchor.backend_binding_ref
    assert requests[0].workspace_ref == workspace.backend_workspace_ref
    assert requests[0].destroy_workspace is True
    assert requests[1].binding_ref == remaining.backend_binding_ref
    assert requests[1].destroy_workspace is False
    assert sqlite_session.get(AgentWorkspace, workspace.id) is None
    assert sqlite_session.get(AgentWorkspaceBinding, anchor.id) is None
    assert sqlite_session.get(AgentWorkspaceBinding, remaining.id) is None


def test_binding_collection_database_failure_is_best_effort(monkeypatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalar.side_effect = RuntimeError("database unavailable")
    log_exception = MagicMock()
    monkeypatch.setattr("services.agent.workspace_service.session_factory.create_session", lambda: context)
    monkeypatch.setattr("services.agent.workspace_service.logger.exception", log_exception)

    AgentWorkspaceService.collect_retired_binding(tenant_id="tenant-1", binding_id="binding-1")

    session.scalar.assert_called_once()
    log_exception.assert_called_once_with(
        "Failed to collect retired Agent Workspace Binding",
        extra={"tenant_id": "tenant-1", "binding_id": "binding-1"},
    )


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_workspace_collection_final_delete_failure_is_best_effort(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workspace = _workspace(status=AgentWorkingResourceStatus.RETIRED)
    anchor = _binding(status=AgentWorkingResourceStatus.RETIRED)
    sqlite_session.add_all([workspace, anchor])
    sqlite_session.commit()
    commit = MagicMock(side_effect=RuntimeError("database unavailable"))
    client = MagicMock()
    log_exception = MagicMock()
    monkeypatch.setattr(
        "services.agent.workspace_service.session_factory.create_session", lambda: nullcontext(sqlite_session)
    )
    monkeypatch.setattr(sqlite_session, "commit", commit)
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))
    monkeypatch.setattr("services.agent.workspace_service.logger.exception", log_exception)

    AgentWorkspaceService.collect_retired_workspace(tenant_id="tenant-1", workspace_id="workspace-1")

    client.destroy_execution_binding_sync.assert_called_once()
    log_exception.assert_called_once_with(
        "Failed to collect retired Agent Workspace",
        extra={"tenant_id": "tenant-1", "workspace_id": "workspace-1"},
    )
