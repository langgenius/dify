import json
from contextlib import nullcontext
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dify_agent.protocol import WorkspaceListResponse, WorkspaceReadResponse
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Conversation, IconType
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
)
from services.agent.workspace_service import AgentWorkspaceService
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    WorkflowAgentSandboxService,
)


def _add_normal_conversation(session: Session, *, binding_id: str) -> Conversation:
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
        agent_workspace_binding_id=binding_id,
    )
    conversation._inputs = {}
    session.add(conversation)
    return conversation


def _add_conversation_bindings(session: Session) -> tuple[AgentWorkspaceBinding, AgentWorkspaceBinding]:
    workspace = AgentWorkspace(
        id="workspace-1",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
        owner_scope_key="root",
        backend_workspace_ref="workspace-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    expected = AgentWorkspaceBinding(
        id="binding-expected",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-expected-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        updated_at=datetime(2026, 7, 23, 10),
    )
    other = AgentWorkspaceBinding(
        id="binding-other",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-other-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        updated_at=datetime(2026, 7, 23, 11),
    )
    session.add_all([workspace, expected, other])
    return expected, other


def _use_session(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    monkeypatch.setattr(
        "services.agent_app_sandbox_service.session_factory.create_session",
        lambda: nullcontext(session),
    )


def _add_build_draft_caller(session: Session, *, parent_app_id: str, backing_app_id: str | None) -> AgentConfigDraft:
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Build Agent",
        description="",
        role="",
        scope=AgentScope.ROSTER if backing_app_id is None else AgentScope.WORKFLOW_ONLY,
        source=AgentSource.AGENT_APP if backing_app_id is None else AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        app_id=parent_app_id,
        backing_app_id=backing_app_id,
    )
    draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        agent_workspace_binding_id="binding-build",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, draft])
    session.commit()
    return draft


def test_agent_app_file_browsing_uses_conversation_pointer(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    expected, _ = _add_conversation_bindings(sqlite_session)
    _add_normal_conversation(sqlite_session, binding_id=expected.id)
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()
    response = WorkspaceListResponse(path=".", entries=[], truncated=False)
    client.list_workspace_files_sync.return_value = response

    result = AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        caller_type="conversation",
        caller_id="conversation-1",
        account_id="account-1",
        path=".",
    )

    assert result is response
    client.list_workspace_files_sync.assert_called_once_with(expected.backend_binding_ref, ".")


def test_agent_app_file_browsing_rejects_other_account(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    expected, _ = _add_conversation_bindings(sqlite_session)
    _add_normal_conversation(sqlite_session, binding_id=expected.id)
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            agent_id="agent-1",
            caller_type="conversation",
            caller_id="conversation-1",
            account_id="account-2",
            path=".",
        )

    assert exc_info.value.code == "no_active_binding"
    client.list_workspace_files_sync.assert_not_called()


@pytest.mark.parametrize(
    ("parent_app_id", "backing_app_id", "runtime_app_id"),
    [
        ("app-1", None, "app-1"),
        ("workflow-app-1", "runtime-app-1", "runtime-app-1"),
    ],
)
def test_agent_app_file_browsing_uses_build_draft_caller(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    parent_app_id: str,
    backing_app_id: str | None,
    runtime_app_id: str,
) -> None:
    _add_build_draft_caller(sqlite_session, parent_app_id=parent_app_id, backing_app_id=backing_app_id)
    _use_session(monkeypatch, sqlite_session)
    workspace = AgentWorkspace(
        id="workspace-build",
        tenant_id="tenant-1",
        app_id=runtime_app_id,
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="build-1",
        owner_scope_key="root",
        backend_workspace_ref="workspace-build-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    binding = AgentWorkspaceBinding(
        id="binding-build",
        tenant_id="tenant-1",
        app_id=runtime_app_id,
        workspace_id=workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id=None,
        agent_config_version_id="build-1",
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        backend_binding_ref="binding-build-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    get_binding = MagicMock(return_value=binding)
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    client = MagicMock()
    response = WorkspaceListResponse(path=".", entries=[], truncated=False)
    client.list_workspace_files_sync.return_value = response

    result = AgentAppSandboxService(client_factory=lambda: nullcontext(client)).list_files(
        tenant_id="tenant-1",
        app_id=runtime_app_id,
        agent_id="agent-1",
        caller_type="build_draft",
        caller_id="build-1",
        account_id="account-1",
        path=".",
    )

    assert result is response
    owner_scope = get_binding.call_args.kwargs["expected_owner_scope"]
    assert owner_scope.app_id == runtime_app_id
    assert owner_scope.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
    assert owner_scope.owner_id == "build-1"
    client.list_workspace_files_sync.assert_called_once_with("binding-build-ref", ".")


def test_workflow_file_access_uses_node_execution_pointer(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    execution = WorkflowNodeExecutionModel(
        id="execution-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="node-1",
        node_type="agent",
        title="Agent",
        agent_workspace_binding_id="binding-workflow",
        inputs="{}",
        process_data=json.dumps({"workflow_agent_binding_id": "workflow-binding-1"}),
        outputs="{}",
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0,
        execution_metadata="{}",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    sqlite_session.add(execution)
    sqlite_session.commit()
    binding = SimpleNamespace(backend_binding_ref="binding-workflow-ref")
    get_binding = MagicMock(return_value=binding)
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    client = MagicMock()
    response = WorkspaceReadResponse(path="report.txt", size=2, truncated=False, binary=False, text="ok")
    client.read_workspace_file_sync.return_value = response

    result = WorkflowAgentSandboxService(client_factory=lambda: nullcontext(client)).read_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        path="report.txt",
        session=sqlite_session,
    )

    assert result is response
    assert get_binding.call_args.kwargs["binding_id"] == "binding-workflow"
    client.read_workspace_file_sync.assert_called_once_with("binding-workflow-ref", "report.txt")
