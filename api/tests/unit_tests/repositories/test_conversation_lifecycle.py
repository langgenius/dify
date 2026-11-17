"""Real-DB tests for shared conversation lifecycle mutations."""

from datetime import datetime

import pytest
from sqlalchemy.orm import Session
from typing_extensions import TypedDict

from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource, InvokeFrom
from models.model import AppMode, Conversation
from repositories.conversation_lifecycle import (
    retire_debug_conversation_workspaces,
    retire_superseded_debug_conversations,
)
from services.errors.conversation import ConversationNotExistsError

_TENANT_ID = "tenant-1"
_APP_ID = "app-1"
_OTHER_APP_ID = "app-2"
_ACCOUNT_ID = "account-1"
_OTHER_ACCOUNT_ID = "account-2"
_RETIRED_AT = datetime(2026, 9, 1)


class _ConversationOverrides(TypedDict, total=False, closed=True):
    app_id: str
    account_id: str | None
    invoke_from: InvokeFrom | None
    from_source: ConversationFromSource
    is_deleted: bool


def _conversation(
    session: Session,
    conversation_id: str,
    *,
    app_id: str = _APP_ID,
    account_id: str | None = _ACCOUNT_ID,
    end_user_id: str | None = None,
    invoke_from: InvokeFrom | None = InvokeFrom.DEBUGGER,
    from_source: ConversationFromSource = ConversationFromSource.CONSOLE,
    is_deleted: bool = False,
) -> Conversation:
    conversation = Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.ADVANCED_CHAT,
        name=conversation_id,
        _inputs={},
        introduction=None,
        from_source=from_source,
        from_end_user_id=end_user_id,
        from_account_id=account_id,
        invoke_from=invoke_from,
        is_deleted=is_deleted,
    )
    session.add(conversation)
    session.flush()
    return conversation


def _conversation_workspace(
    session: Session,
    workspace_id: str,
    conversation: Conversation,
    *,
    owner_scope_key: str = "root",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
) -> AgentWorkspace:
    workspace = AgentWorkspace(
        id=workspace_id,
        tenant_id=_TENANT_ID,
        app_id=conversation.app_id,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=conversation.id,
        owner_scope_key=owner_scope_key,
        backend_workspace_ref=f"{workspace_id}-ref",
        status=status,
        active_guard=1 if status == AgentWorkingResourceStatus.ACTIVE else None,
        retired_at=None if status == AgentWorkingResourceStatus.ACTIVE else _RETIRED_AT,
    )
    session.add(workspace)
    session.flush()
    return workspace


def _conversation_binding(binding_id: str, workspace: AgentWorkspace) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=workspace.tenant_id,
        app_id=workspace.app_id,
        workspace_id=workspace.id,
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=f"{binding_id}-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


def test_retire_superseded_debug_conversations_retires_only_superseded_debug_workspaces(
    sqlite_session: Session,
) -> None:
    current = _conversation(sqlite_session, "conv-current")
    current_workspace = _conversation_workspace(sqlite_session, "ws-current", current)

    superseded_a = _conversation(sqlite_session, "conv-old-a")
    superseded_a_root = _conversation_workspace(sqlite_session, "ws-old-a-root", superseded_a)
    superseded_a_node = _conversation_workspace(
        sqlite_session, "ws-old-a-node", superseded_a, owner_scope_key="node-1:binding-1"
    )
    superseded_b = _conversation(sqlite_session, "conv-old-b")
    superseded_b_workspace = _conversation_workspace(sqlite_session, "ws-old-b", superseded_b)
    superseded_binding = _conversation_binding("binding-old-a", superseded_a_root)

    other_account = _conversation(sqlite_session, "conv-other-account", account_id=_OTHER_ACCOUNT_ID)
    other_account_workspace = _conversation_workspace(sqlite_session, "ws-other-account", other_account)

    deleted = _conversation(sqlite_session, "conv-deleted", is_deleted=True)
    deleted_workspace = _conversation_workspace(sqlite_session, "ws-deleted", deleted)

    web_app = _conversation(
        sqlite_session,
        "conv-web-app",
        account_id=None,
        end_user_id="end-user-1",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.API,
    )
    web_app_workspace = _conversation_workspace(sqlite_session, "ws-web-app", web_app)

    console_explore = _conversation(sqlite_session, "conv-console-explore", invoke_from=InvokeFrom.EXPLORE)
    console_explore_workspace = _conversation_workspace(sqlite_session, "ws-console-explore", console_explore)

    legacy = _conversation(sqlite_session, "conv-legacy", invoke_from=None)
    legacy_workspace = _conversation_workspace(sqlite_session, "ws-legacy", legacy)

    other_app = _conversation(sqlite_session, "conv-other-app", app_id=_OTHER_APP_ID)
    other_app_workspace = _conversation_workspace(sqlite_session, "ws-other-app", other_app)

    already_retired = _conversation(sqlite_session, "conv-old-retired")
    retired_workspace = _conversation_workspace(
        sqlite_session, "ws-old-retired", already_retired, status=AgentWorkingResourceStatus.RETIRED
    )

    sqlite_session.add(superseded_binding)
    sqlite_session.commit()

    retired_workspace_ids = retire_superseded_debug_conversations(
        session=sqlite_session,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        account_id=_ACCOUNT_ID,
        current_conversation_id=current.id,
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    assert isinstance(retired_workspace_ids, tuple)
    assert set(retired_workspace_ids) == {
        superseded_a_root.id,
        superseded_a_node.id,
        superseded_b_workspace.id,
    }
    for workspace in (superseded_a_root, superseded_a_node, superseded_b_workspace):
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert workspace.active_guard is None
        assert workspace.retired_at is not None
    assert superseded_binding.status is AgentWorkingResourceStatus.RETIRED
    assert superseded_binding.retired_at == superseded_a_root.retired_at

    for workspace in (
        current_workspace,
        other_account_workspace,
        deleted_workspace,
        web_app_workspace,
        console_explore_workspace,
        legacy_workspace,
        other_app_workspace,
    ):
        assert workspace.status is AgentWorkingResourceStatus.ACTIVE
        assert workspace.active_guard == 1
        assert workspace.retired_at is None
    assert retired_workspace.status is AgentWorkingResourceStatus.RETIRED
    assert retired_workspace.retired_at == _RETIRED_AT


def test_retire_debug_conversation_workspaces_retires_only_target_debug_workspaces(
    sqlite_session: Session,
) -> None:
    target = _conversation(sqlite_session, "conv-target")
    target_root = _conversation_workspace(sqlite_session, "ws-target-root", target)
    target_node = _conversation_workspace(sqlite_session, "ws-target-node", target, owner_scope_key="node-1:binding-1")
    target_binding = _conversation_binding("binding-target", target_root)

    other_debug = _conversation(sqlite_session, "conv-other-debug")
    other_debug_workspace = _conversation_workspace(sqlite_session, "ws-other-debug", other_debug)

    other_account = _conversation(sqlite_session, "conv-other-account", account_id=_OTHER_ACCOUNT_ID)
    other_account_workspace = _conversation_workspace(sqlite_session, "ws-other-account", other_account)

    deleted = _conversation(sqlite_session, "conv-deleted", is_deleted=True)
    deleted_workspace = _conversation_workspace(sqlite_session, "ws-deleted", deleted)

    other_app = _conversation(sqlite_session, "conv-other-app", app_id=_OTHER_APP_ID)
    other_app_workspace = _conversation_workspace(sqlite_session, "ws-other-app", other_app)

    sqlite_session.add(target_binding)
    sqlite_session.commit()

    retired_workspace_ids = retire_debug_conversation_workspaces(
        session=sqlite_session,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        account_id=_ACCOUNT_ID,
        conversation_id=target.id,
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    assert isinstance(retired_workspace_ids, tuple)
    assert set(retired_workspace_ids) == {target_root.id, target_node.id}
    for workspace in (target_root, target_node):
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert workspace.active_guard is None
        assert workspace.retired_at is not None
    assert target_binding.status is AgentWorkingResourceStatus.RETIRED
    assert target_binding.retired_at == target_root.retired_at

    for workspace in (
        other_debug_workspace,
        other_account_workspace,
        deleted_workspace,
        other_app_workspace,
    ):
        assert workspace.status is AgentWorkingResourceStatus.ACTIVE
        assert workspace.active_guard == 1
        assert workspace.retired_at is None

    persisted = sqlite_session.get(Conversation, target.id)
    assert persisted is not None
    assert persisted.is_deleted is False


@pytest.mark.parametrize(
    "overrides",
    [
        {"account_id": _OTHER_ACCOUNT_ID},
        {"invoke_from": InvokeFrom.EXPLORE},
        {"invoke_from": None},
        {"from_source": ConversationFromSource.API},
        {"is_deleted": True},
        {"app_id": _OTHER_APP_ID},
    ],
    ids=["other-account", "explore-invoke", "legacy-invoke", "api-source", "deleted", "other-app"],
)
def test_retire_debug_conversation_workspaces_rejects_foreign_or_non_debug(
    sqlite_session: Session, overrides: _ConversationOverrides
) -> None:
    conversation = _conversation(sqlite_session, "conv-reject", **overrides)
    workspace = _conversation_workspace(sqlite_session, "ws-reject", conversation)
    sqlite_session.commit()

    with pytest.raises(ConversationNotExistsError):
        retire_debug_conversation_workspaces(
            session=sqlite_session,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation.id,
        )

    sqlite_session.expire_all()
    assert workspace.status is AgentWorkingResourceStatus.ACTIVE
    assert workspace.active_guard == 1
    assert workspace.retired_at is None


def test_retire_debug_conversation_workspaces_rejects_unknown_conversation(sqlite_session: Session) -> None:
    with pytest.raises(ConversationNotExistsError):
        retire_debug_conversation_workspaces(
            session=sqlite_session,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            account_id=_ACCOUNT_ID,
            conversation_id="conv-missing",
        )


def test_retire_debug_conversation_workspaces_returns_empty_when_already_retired(
    sqlite_session: Session,
) -> None:
    conversation = _conversation(sqlite_session, "conv-already-retired")
    workspace = _conversation_workspace(
        sqlite_session,
        "ws-already-retired",
        conversation,
        status=AgentWorkingResourceStatus.RETIRED,
    )
    sqlite_session.commit()

    retired_workspace_ids = retire_debug_conversation_workspaces(
        session=sqlite_session,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
    )
    sqlite_session.expire_all()

    assert retired_workspace_ids == ()
    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert workspace.retired_at == _RETIRED_AT
