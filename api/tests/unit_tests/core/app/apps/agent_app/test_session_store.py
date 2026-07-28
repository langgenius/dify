from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot

from core.app.apps.agent_app.session_store import AgentAppSessionScope, AgentAppWorkspaceStore
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService


def _scope(
    *,
    kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
    build_draft_id: str | None = None,
) -> AgentAppSessionScope:
    return AgentAppSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        home_snapshot_id="home-1",
        agent_config_version_kind=kind,
        build_draft_id=build_draft_id,
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
    build_owner = _scope(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        build_draft_id="build-draft-1",
    ).workspace_owner
    assert build_owner.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
    assert build_owner.owner_id == "build-draft-1"


def test_load_or_create_persists_new_binding_on_caller(monkeypatch) -> None:
    caller = SimpleNamespace(agent_workspace_binding_id=None)
    context = MagicMock()
    session = context.__enter__.return_value
    create = MagicMock(return_value=_binding())
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr("core.app.apps.agent_app.session_store.session_factory.create_session", lambda: context)
    monkeypatch.setattr(store, "_load_caller", MagicMock(return_value=caller))
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope())

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"
    assert caller.agent_workspace_binding_id == "binding-1"
    assert create.call_args.kwargs["session"] is session
    session.commit.assert_called_once_with()


def test_load_or_create_uses_exact_caller_binding(monkeypatch) -> None:
    caller = SimpleNamespace(agent_workspace_binding_id="binding-1")
    context = MagicMock()
    context.__enter__.return_value = MagicMock()
    get_binding = MagicMock(return_value=_binding())
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr("core.app.apps.agent_app.session_store.session_factory.create_session", lambda: context)
    monkeypatch.setattr(store, "_load_caller", MagicMock(return_value=caller))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", MagicMock())
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope())

    assert stored.binding_id == "binding-1"
    assert get_binding.call_args.kwargs["binding_id"] == "binding-1"
    create.assert_not_called()


def test_normal_conversation_pointer_does_not_create_replacement_binding(monkeypatch) -> None:
    caller = SimpleNamespace(agent_workspace_binding_id="unavailable-binding")
    context = MagicMock()
    get_binding = MagicMock(return_value=None)
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr("core.app.apps.agent_app.session_store.session_factory.create_session", lambda: context)
    monkeypatch.setattr(store, "_load_caller", MagicMock(return_value=caller))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    with pytest.raises(AgentWorkspaceNotFoundError, match="Caller participant Binding is unavailable"):
        store.load_or_create(_scope())

    assert get_binding.call_args.kwargs["binding_id"] == "unavailable-binding"
    create.assert_not_called()


def test_save_snapshot_targets_binding(monkeypatch) -> None:
    save = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "save_binding_session_snapshot", save)
    snapshot = CompositorSessionSnapshot(layers=[])

    AgentAppWorkspaceStore().save_active_snapshot(scope=_scope(), binding_id="binding-1", snapshot=snapshot)

    assert save.call_args.kwargs["binding_id"] == "binding-1"
    assert save.call_args.kwargs["session_snapshot"] == snapshot.model_dump_json()
