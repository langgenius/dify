from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.agent_app.session_store import AgentAppSessionScope, AgentAppWorkspaceStore
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, AppMode, Conversation
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService


def _scope(
    *,
    kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
    build_draft_id: str | None = None,
    home_snapshot_id: str | None = "home-1",
) -> AgentAppSessionScope:
    return AgentAppSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        home_snapshot_id=home_snapshot_id,
        agent_config_version_kind=kind,
        build_draft_id=build_draft_id,
    )


def _binding() -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
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


def _persist_conversation(session: Session, *, binding_id: str | None = None) -> Conversation:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Agent App",
        description="",
        mode=AppMode.AGENT_CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        app_model_config_id=None,
        workflow_id=None,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
        created_by=None,
    )
    conversation = Conversation(
        id="conversation-1",
        app_id=app.id,
        app_model_config_id=None,
        agent_workspace_binding_id=binding_id,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.AGENT_CHAT,
        name="Agent conversation",
        summary=None,
        inputs={},
        introduction="",
        system_instruction="",
        invoke_from=None,
        from_source="api",
        from_end_user_id="user-1",
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    session.add_all([app, conversation])
    session.commit()
    return conversation


def test_scope_selects_conversation_or_build_draft_workspace_owner() -> None:
    assert _scope().workspace_owner.owner_type is AgentWorkspaceOwnerType.CONVERSATION
    build_owner = _scope(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        build_draft_id="build-draft-1",
    ).workspace_owner
    assert build_owner.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
    assert build_owner.owner_id == "build-draft-1"


@pytest.mark.parametrize("home_snapshot_id", ["home-1", None])
def test_load_or_create_persists_new_binding_on_caller(
    monkeypatch: pytest.MonkeyPatch,
    home_snapshot_id: str | None,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session)
    create = MagicMock(return_value=_binding())
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope(home_snapshot_id=home_snapshot_id))

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"
    assert isinstance(create.call_args.kwargs["session"], Session)
    assert create.call_args.kwargs["base_home_snapshot_id"] == home_snapshot_id
    with sqlite_session_factory() as observer:
        caller = observer.get(Conversation, "conversation-1")
        assert caller is not None
        assert caller.agent_workspace_binding_id == "binding-1"


def test_load_or_create_uses_exact_caller_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_conversation(sqlite_session, binding_id="binding-1")
    get_binding = MagicMock(return_value=_binding())
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", MagicMock())
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope())

    assert stored.binding_id == "binding-1"
    assert get_binding.call_args.kwargs["binding_id"] == "binding-1"
    create.assert_not_called()


def test_normal_conversation_pointer_does_not_create_replacement_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_conversation(sqlite_session, binding_id="unavailable-binding")
    get_binding = MagicMock(return_value=None)
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    with pytest.raises(AgentWorkspaceNotFoundError, match="Caller participant Binding is unavailable"):
        store.load_or_create(_scope())

    assert get_binding.call_args.kwargs["binding_id"] == "unavailable-binding"
    create.assert_not_called()


def test_save_snapshot_targets_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    save = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "save_binding_session_snapshot", save)
    snapshot = CompositorSessionSnapshot(layers=[])

    AgentAppWorkspaceStore().save_active_snapshot(scope=_scope(), binding_id="binding-1", snapshot=snapshot)

    assert save.call_args.kwargs["binding_id"] == "binding-1"
    assert save.call_args.kwargs["session_snapshot"] == snapshot.model_dump_json()
