from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy.orm import Session

from core.app.apps.agent_app.session_store import AgentAppSessionScope, AgentAppWorkspaceStore
from models.agent import (
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceService


def _scope(*, kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT) -> AgentAppSessionScope:
    return AgentAppSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        home_snapshot_id="home-1",
        agent_config_version_kind=kind,
    )


def _binding() -> SimpleNamespace:
    return SimpleNamespace(
        id="binding-1",
        workspace_id="workspace-1",
        backend_binding_ref="backend-binding-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        base_home_snapshot_id="home-1",
        session_snapshot=None,
        pending_form_id=None,
        pending_tool_call_id=None,
    )


def test_scope_selects_conversation_or_build_draft_workspace_owner() -> None:
    assert _scope().workspace_owner.owner_type is AgentWorkspaceOwnerType.CONVERSATION
    build_owner = _scope(kind=AgentConfigVersionKind.BUILD_DRAFT).workspace_owner
    assert build_owner.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT


def test_resolve_or_create_returns_binding_identity(monkeypatch) -> None:
    create = MagicMock(return_value=_binding())
    monkeypatch.setattr(AgentWorkspaceService, "create_or_resolve_binding", create)

    stored = AgentAppWorkspaceStore().resolve_or_create(_scope())

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"
    create.assert_called_once()


def test_save_snapshot_targets_binding(monkeypatch) -> None:
    save = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "save_binding_session_snapshot", save)
    snapshot = CompositorSessionSnapshot(layers=[])

    AgentAppWorkspaceStore().save_active_snapshot(scope=_scope(), binding_id="binding-1", snapshot=snapshot)

    assert save.call_args.kwargs["binding_id"] == "binding-1"
    assert save.call_args.kwargs["session_snapshot"] == snapshot.model_dump_json()


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentDebugConversation, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_debug_resume_loads_latest_matching_build_draft_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    base_time = datetime(2026, 7, 23, 10)
    sqlite_session.add_all(
        [
            AgentDebugConversation(
                id="debug-current",
                tenant_id="tenant-1",
                app_id="app-1",
                agent_id="agent-1",
                account_id="account-1",
                conversation_id="conversation-1",
                updated_at=base_time,
            ),
            AgentDebugConversation(
                id="debug-other-app",
                tenant_id="tenant-1",
                app_id="app-2",
                agent_id="agent-2",
                account_id="account-2",
                conversation_id="conversation-1",
                updated_at=base_time + timedelta(minutes=3),
            ),
        ]
    )
    conversation_workspace = AgentWorkspace(
        id="workspace-conversation",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
        owner_scope_key="root",
        backend_workspace_ref="workspace-conversation-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=base_time,
    )
    build_workspace = AgentWorkspace(
        id="workspace-build",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="conversation-1",
        owner_scope_key="root",
        backend_workspace_ref="workspace-build-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=base_time + timedelta(minutes=1),
    )
    conversation_binding = AgentWorkspaceBinding(
        id="binding-conversation",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=conversation_workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id="home-conversation",
        agent_config_version_id="normal-draft-1",
        agent_config_version_kind=AgentConfigVersionKind.DRAFT,
        backend_binding_ref="binding-conversation-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=base_time,
    )
    build_binding = AgentWorkspaceBinding(
        id="binding-build",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=build_workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id="home-build",
        agent_config_version_id="build-draft-1",
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        backend_binding_ref="binding-build-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=base_time + timedelta(minutes=1),
    )
    sqlite_session.add_all([conversation_workspace, build_workspace, conversation_binding, build_binding])
    sqlite_session.commit()
    monkeypatch.setattr(
        "core.app.apps.agent_app.session_store.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    stored = AgentAppWorkspaceStore().load_active_session_for_conversation(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
    )

    assert stored is not None
    assert stored.binding_id == build_binding.id
    assert stored.scope.agent_id == "agent-1"
    assert stored.scope.agent_config_snapshot_id == "build-draft-1"
    assert stored.scope.agent_config_version_kind is AgentConfigVersionKind.BUILD_DRAFT
