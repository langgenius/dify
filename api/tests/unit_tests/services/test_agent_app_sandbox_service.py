from contextlib import nullcontext
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from dify_agent.protocol import WorkspaceListResponse, WorkspaceReadResponse
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, IconType
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    WorkflowAgentSandboxService,
)


def _add_binding(
    session: Session,
    *,
    workspace_id: str,
    binding_id: str,
    owner_type: AgentWorkspaceOwnerType,
    updated_at: datetime,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    owner_id: str = "conversation-1",
    owner_scope_key: str = "root",
    agent_id: str = "agent-1",
) -> AgentWorkspaceBinding:
    workspace = AgentWorkspace(
        id=workspace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        owner_type=owner_type,
        owner_id=owner_id,
        owner_scope_key=owner_scope_key,
        backend_workspace_ref=f"{workspace_id}-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=updated_at,
    )
    config_kind = (
        AgentConfigVersionKind.BUILD_DRAFT
        if owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
        else AgentConfigVersionKind.SNAPSHOT
    )
    binding = AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        base_home_snapshot_id="home-1",
        agent_config_version_id=f"{binding_id}-config",
        agent_config_version_kind=config_kind,
        backend_binding_ref=f"{binding_id}-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
        updated_at=updated_at,
    )
    session.add_all([workspace, binding])
    return binding


def _add_debug_conversation(session: Session, *, account_id: str = "account-1") -> None:
    session.add(
        AgentDebugConversation(
            id=f"debug-{account_id}",
            tenant_id="tenant-1",
            app_id="app-1",
            agent_id="agent-1",
            account_id=account_id,
            conversation_id="conversation-1",
        )
    )


def _add_normal_conversation(session: Session) -> None:
    session.add(
        App(
            id="app-1",
            tenant_id="tenant-1",
            name="Agent App",
            description="",
            mode=AppMode.AGENT,
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=False,
            max_active_requests=0,
        )
    )
    conversation = Conversation(
        id="conversation-1",
        app_id="app-1",
        mode=AppMode.AGENT,
        name="Conversation",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="account-1",
        is_deleted=False,
    )
    conversation._inputs = {}
    session.add(conversation)


def _use_session(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    monkeypatch.setattr(
        "services.agent_app_sandbox_service.session_factory.create_session",
        lambda: nullcontext(session),
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentDebugConversation, AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
def test_debug_file_browsing_selects_newest_matching_build_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    base_time = datetime(2026, 7, 23, 10)
    _add_debug_conversation(sqlite_session)
    _add_binding(
        sqlite_session,
        workspace_id="workspace-conversation",
        binding_id="binding-conversation",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        updated_at=base_time,
    )
    expected = _add_binding(
        sqlite_session,
        workspace_id="workspace-build",
        binding_id="binding-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=base_time + timedelta(minutes=1),
    )
    _add_binding(
        sqlite_session,
        workspace_id="workspace-other-tenant",
        binding_id="binding-other-tenant",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=base_time + timedelta(minutes=3),
        tenant_id="tenant-2",
    )
    _add_binding(
        sqlite_session,
        workspace_id="workspace-other-agent",
        binding_id="binding-other-agent",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=base_time + timedelta(minutes=2),
        owner_id="conversation-2",
        agent_id="agent-2",
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()
    response = WorkspaceListResponse(path=".", entries=[], truncated=False)
    client.list_workspace_files_sync.return_value = response

    result = AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        conversation_id="conversation-1",
        account_id="account-1",
        path=".",
    )

    assert result is response
    client.list_workspace_files_sync.assert_called_once_with(expected.backend_binding_ref, ".")


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentDebugConversation, AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
def test_normal_conversation_file_browsing_excludes_newer_build_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    base_time = datetime(2026, 7, 23, 10)
    _add_normal_conversation(sqlite_session)
    expected = _add_binding(
        sqlite_session,
        workspace_id="workspace-conversation",
        binding_id="binding-conversation",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        updated_at=base_time,
    )
    _add_binding(
        sqlite_session,
        workspace_id="workspace-build",
        binding_id="binding-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=base_time + timedelta(minutes=1),
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()
    response = WorkspaceListResponse(path=".", entries=[], truncated=False)
    client.list_workspace_files_sync.return_value = response

    result = AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        conversation_id="conversation-1",
        account_id="account-1",
        path=".",
    )

    assert result is response
    client.list_workspace_files_sync.assert_called_once_with(expected.backend_binding_ref, ".")


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentDebugConversation, AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
@pytest.mark.parametrize(
    ("app_id", "account_id"),
    [("app-2", "account-1"), ("app-1", "account-2")],
)
def test_agent_app_file_browsing_rejects_other_app_or_account(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    app_id: str,
    account_id: str,
) -> None:
    _add_debug_conversation(sqlite_session)
    _add_binding(
        sqlite_session,
        workspace_id="workspace-build",
        binding_id="binding-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=datetime(2026, 7, 23, 10),
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
            tenant_id="tenant-1",
            app_id=app_id,
            agent_id="agent-1",
            conversation_id="conversation-1",
            account_id=account_id,
            path=".",
        )

    assert exc_info.value.code == "no_active_binding"
    client.list_workspace_files_sync.assert_not_called()


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentDebugConversation, AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
def test_agent_app_info_exposes_workspace_relative_cwd(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _add_debug_conversation(sqlite_session)
    _add_binding(
        sqlite_session,
        workspace_id="workspace-build",
        binding_id="binding-build",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        updated_at=datetime(2026, 7, 23, 10),
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)

    result = AgentAppSandboxService().get_info(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        conversation_id="conversation-1",
        account_id="account-1",
    )

    assert result.workspace_cwd == "."


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_workflow_file_access_uses_matching_binding(
    sqlite_session: Session,
) -> None:
    binding = _add_binding(
        sqlite_session,
        workspace_id="workspace-workflow",
        binding_id="binding-workflow",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-1",
        owner_scope_key="node-1:workflow-binding-1",
        updated_at=datetime(2026, 7, 23, 10),
    )
    sqlite_session.commit()
    client = MagicMock()
    response = WorkspaceReadResponse(path="report.txt", size=2, truncated=False, binary=False, text="ok")
    client.read_workspace_file_sync.return_value = response

    result = WorkflowAgentSandboxService(client_factory=lambda: nullcontext(client)).read_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        path="report.txt",
        session=sqlite_session,
    )

    assert result is response
    client.read_workspace_file_sync.assert_called_once_with(binding.backend_binding_ref, "report.txt")
