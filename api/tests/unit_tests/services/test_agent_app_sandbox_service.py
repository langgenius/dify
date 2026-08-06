import json
from contextlib import contextmanager, nullcontext
from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from dify_agent.client import Client
from dify_agent.protocol import BindingFileDownloadResponse, BindingFileListResponse, BindingFileReadResponse
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowNodeExecutionStatus
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentKind,
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
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services import agent_app_sandbox_service as sandbox_module
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxDownload,
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


def _add_app(session: Session, *, app_id: str, tenant_id: str) -> None:
    session.add(
        App(
            id=app_id,
            tenant_id=tenant_id,
            name=f"App {app_id}",
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


def _add_binding(
    session: Session,
    *,
    binding_id: str,
    workspace_id: str,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    agent_id: str = "agent-1",
    owner_type: AgentWorkspaceOwnerType,
    owner_id: str,
    owner_scope_key: str = "root",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
    agent_config_version_id: str | None = None,
    agent_config_version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
) -> AgentWorkspaceBinding:
    active_guard = 1 if status is AgentWorkingResourceStatus.ACTIVE else None
    workspace = AgentWorkspace(
        id=workspace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        owner_type=owner_type,
        owner_id=owner_id,
        owner_scope_key=owner_scope_key,
        backend_workspace_ref=f"{workspace_id}-ref",
        status=status,
        active_guard=active_guard,
    )
    binding = AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        base_home_snapshot_id=None,
        agent_config_version_id=agent_config_version_id or f"{binding_id}-config",
        agent_config_version_kind=agent_config_version_kind,
        backend_binding_ref=f"{binding_id}-ref",
        status=status,
    )
    session.add_all([workspace, binding])
    return binding


def _add_build_draft_caller(
    session: Session,
    *,
    parent_app_id: str = "app-1",
    backing_app_id: str | None = None,
    runtime_app_id: str = "app-1",
) -> AgentWorkspaceBinding:
    session.add(
        Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY if backing_app_id else AgentScope.ROSTER,
            source=AgentSource.WORKFLOW if backing_app_id else AgentSource.AGENT_APP,
            app_id=parent_app_id,
            backing_app_id=backing_app_id,
            status=AgentStatus.ACTIVE,
        )
    )
    binding = _add_binding(
        session,
        binding_id="binding-build",
        workspace_id="workspace-build",
        app_id=runtime_app_id,
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="build-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.DRAFT,
    )
    session.add(
        AgentConfigDraft(
            id="build-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            agent_workspace_binding_id=binding.id,
            config_snapshot=AgentSoulConfig(),
        )
    )
    return binding


def _download_client() -> MagicMock:
    client = MagicMock()
    client.download_binding_file_sync.return_value = BindingFileDownloadResponse(reference="dify-file-ref:canonical")
    return client


def _stub_download_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sandbox_module,
        "_download_response",
        lambda **_kwargs: AgentSandboxDownload(url="https://files.example/report.txt"),
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
def test_agent_app_file_browsing_uses_conversation_pointer(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    expected, _ = _add_conversation_bindings(sqlite_session)
    _add_normal_conversation(sqlite_session, binding_id=expected.id)
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()
    response = BindingFileListResponse(path=".", entries=[], truncated=False)
    client.list_binding_files_sync.return_value = response

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
    client.list_binding_files_sync.assert_called_once_with(expected.backend_binding_ref, ".")


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
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
    client.list_binding_files_sync.assert_not_called()


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentWorkspace, AgentWorkspaceBinding, App, Conversation)],
    indirect=True,
)
def test_agent_conversation_download_resolves_only_exact_active_owner_chain(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _add_app(sqlite_session, app_id="app-1", tenant_id="tenant-1")
    _add_app(sqlite_session, app_id="app-other", tenant_id="tenant-other")
    valid = _add_binding(
        sqlite_session,
        binding_id="binding-valid",
        workspace_id="workspace-valid",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-valid",
    )
    wrong_owner = _add_binding(
        sqlite_session,
        binding_id="binding-wrong-owner",
        workspace_id="workspace-wrong-owner",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-not-the-caller",
    )
    retired = _add_binding(
        sqlite_session,
        binding_id="binding-retired",
        workspace_id="workspace-retired",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-retired",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    cross_tenant = _add_binding(
        sqlite_session,
        binding_id="binding-cross-tenant",
        workspace_id="workspace-cross-tenant",
        tenant_id="tenant-other",
        app_id="app-other",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-cross-tenant",
    )
    conversations = [
        Conversation(
            id="conversation-valid",
            app_id="app-1",
            mode=AppMode.AGENT,
            name="Valid",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-1",
            is_deleted=False,
            agent_workspace_binding_id=valid.id,
        ),
        Conversation(
            id="conversation-wrong-owner",
            app_id="app-1",
            mode=AppMode.AGENT,
            name="Wrong owner",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-1",
            is_deleted=False,
            agent_workspace_binding_id=wrong_owner.id,
        ),
        Conversation(
            id="conversation-retired",
            app_id="app-1",
            mode=AppMode.AGENT,
            name="Retired",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-1",
            is_deleted=False,
            agent_workspace_binding_id=retired.id,
        ),
        Conversation(
            id="conversation-cross-tenant",
            app_id="app-other",
            mode=AppMode.AGENT,
            name="Cross tenant",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-other",
            is_deleted=False,
            agent_workspace_binding_id=cross_tenant.id,
        ),
    ]
    for conversation in conversations:
        conversation._inputs = {}
    sqlite_session.add_all(conversations)
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    _stub_download_response(monkeypatch)
    client = _download_client()
    service = AgentAppSandboxService(client_factory=lambda: nullcontext(cast(Client, client)))

    result = service.download_file(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        caller_type="conversation",
        caller_id="conversation-valid",
        account_id="account-1",
        path="report.txt",
    )

    assert result.url == "https://files.example/report.txt"
    request = client.download_binding_file_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-valid-ref"
    client.download_binding_file_sync.reset_mock()

    rejected_locators = [
        {"account_id": "account-other"},
        {"app_id": "app-other"},
        {"caller_id": "conversation-wrong-owner"},
        {"caller_id": "conversation-retired"},
        {
            "tenant_id": "tenant-1",
            "app_id": "app-other",
            "caller_id": "conversation-cross-tenant",
            "account_id": "account-other",
        },
    ]
    for override in rejected_locators:
        locator = {
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "agent_id": "agent-1",
            "caller_type": "conversation",
            "caller_id": "conversation-valid",
            "account_id": "account-1",
            "path": "report.txt",
        }
        locator.update(override)
        with pytest.raises(AgentSandboxInspectorError, match="active Agent Workspace Binding"):
            service.download_file(**locator)  # type: ignore[arg-type]

    client.download_binding_file_sync.assert_not_called()


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, AgentConfigDraft, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_agent_build_draft_download_resolves_only_exact_active_owner_chain(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    sqlite_session.add_all(
        [
            Agent(
                id="agent-1",
                tenant_id="tenant-1",
                name="Agent",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id="app-1",
                status=AgentStatus.ACTIVE,
            ),
            Agent(
                id="agent-cross-tenant",
                tenant_id="tenant-other",
                name="Other tenant Agent",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id="app-other",
                status=AgentStatus.ACTIVE,
            ),
        ]
    )
    valid = _add_binding(
        sqlite_session,
        binding_id="binding-build-valid",
        workspace_id="workspace-build-valid",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="draft-valid",
    )
    wrong_owner = _add_binding(
        sqlite_session,
        binding_id="binding-build-wrong-owner",
        workspace_id="workspace-build-wrong-owner",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="draft-not-the-caller",
    )
    retired = _add_binding(
        sqlite_session,
        binding_id="binding-build-retired",
        workspace_id="workspace-build-retired",
        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
        owner_id="draft-retired",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    drafts = [
        AgentConfigDraft(
            id="draft-valid",
            tenant_id="tenant-1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            agent_workspace_binding_id=valid.id,
            config_snapshot=AgentSoulConfig(),
        ),
        AgentConfigDraft(
            id="draft-wrong-owner",
            tenant_id="tenant-1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-2",
            draft_owner_key="account-2",
            agent_workspace_binding_id=wrong_owner.id,
            config_snapshot=AgentSoulConfig(),
        ),
        AgentConfigDraft(
            id="draft-retired",
            tenant_id="tenant-1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-3",
            draft_owner_key="account-3",
            agent_workspace_binding_id=retired.id,
            config_snapshot=AgentSoulConfig(),
        ),
        AgentConfigDraft(
            id="draft-cross-tenant",
            tenant_id="tenant-other",
            agent_id="agent-cross-tenant",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-other",
            draft_owner_key="account-other",
            agent_workspace_binding_id=None,
            config_snapshot=AgentSoulConfig(),
        ),
    ]
    sqlite_session.add_all(drafts)
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    _stub_download_response(monkeypatch)
    client = _download_client()
    service = AgentAppSandboxService(client_factory=lambda: nullcontext(cast(Client, client)))

    result = service.download_file(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        caller_type="build_draft",
        caller_id="draft-valid",
        account_id="account-1",
        path="report.txt",
    )

    assert result.url == "https://files.example/report.txt"
    assert client.download_binding_file_sync.call_args.args[0].backend_binding_ref == "binding-build-valid-ref"
    client.download_binding_file_sync.reset_mock()

    rejected_locators = [
        {"account_id": "account-other"},
        {"app_id": "app-other"},
        {"caller_id": "draft-wrong-owner", "account_id": "account-2"},
        {"caller_id": "draft-retired", "account_id": "account-3"},
        {
            "tenant_id": "tenant-1",
            "app_id": "app-other",
            "agent_id": "agent-cross-tenant",
            "caller_id": "draft-cross-tenant",
            "account_id": "account-other",
        },
    ]
    for override in rejected_locators:
        locator = {
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "agent_id": "agent-1",
            "caller_type": "build_draft",
            "caller_id": "draft-valid",
            "account_id": "account-1",
            "path": "report.txt",
        }
        locator.update(override)
        with pytest.raises(AgentSandboxInspectorError, match="active Agent Workspace Binding"):
            service.download_file(**locator)  # type: ignore[arg-type]

    client.download_binding_file_sync.assert_not_called()


def _workflow_execution(
    *,
    execution_id: str,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    workflow_run_id: str = "run-1",
    node_id: str = "node-1",
    binding_id: str | None,
    workflow_agent_binding_id: str | None = "workflow-binding-1",
    created_by: str = "historical-account",
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=workflow_run_id,
        index=1,
        node_id=node_id,
        node_type="agent",
        title=node_id,
        agent_workspace_binding_id=binding_id,
        inputs=None,
        process_data=json.dumps(
            {"workflow_agent_binding_id": workflow_agent_binding_id} if workflow_agent_binding_id is not None else {}
        ),
        outputs=None,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(WorkflowNodeExecutionModel, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_workflow_download_resolves_only_exact_active_owner_chain(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    valid = _add_binding(
        sqlite_session,
        binding_id="binding-workflow-valid",
        workspace_id="workspace-workflow-valid",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-1",
        owner_scope_key="node-1:workflow-binding-1",
    )
    wrong_owner = _add_binding(
        sqlite_session,
        binding_id="binding-workflow-wrong-owner",
        workspace_id="workspace-workflow-wrong-owner",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-not-the-caller",
        owner_scope_key="node-1:workflow-binding-1",
    )
    retired = AgentWorkspaceBinding(
        id="binding-workflow-retired",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=valid.workspace_id,
        agent_id="agent-1",
        base_home_snapshot_id=None,
        agent_config_version_id="binding-workflow-retired-config",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-workflow-retired-ref",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    sqlite_session.add(retired)
    sqlite_session.add_all(
        [
            _workflow_execution(execution_id="execution-valid", binding_id=valid.id),
            _workflow_execution(
                execution_id="execution-cross-tenant",
                tenant_id="tenant-other",
                binding_id=valid.id,
            ),
            _workflow_execution(execution_id="execution-wrong-app", app_id="app-other", binding_id=valid.id),
            _workflow_execution(execution_id="execution-wrong-run", workflow_run_id="run-other", binding_id=valid.id),
            _workflow_execution(execution_id="execution-wrong-node", node_id="node-other", binding_id=valid.id),
            _workflow_execution(execution_id="execution-wrong-owner", binding_id=wrong_owner.id),
            _workflow_execution(execution_id="execution-retired", binding_id=retired.id),
        ]
    )
    sqlite_session.commit()
    persisted_execution = sqlite_session.get(WorkflowNodeExecutionModel, "execution-valid")
    assert persisted_execution is not None
    assert persisted_execution.created_by == "historical-account"
    _use_session(monkeypatch, sqlite_session)
    client = _download_client()
    request_download = MagicMock(
        return_value=SimpleNamespace(download_uri="/files/tools/report.txt?timestamp=1&sign=2")
    )
    monkeypatch.setattr(
        sandbox_module,
        "FileRequestService",
        lambda: SimpleNamespace(request_download=request_download),
    )
    monkeypatch.setattr(sandbox_module.dify_config, "FILES_URL", "https://files.example")
    service = WorkflowAgentSandboxService(client_factory=lambda: nullcontext(cast(Client, client)))

    result = service.download_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-valid",
        account_id="authenticated-account",
        path="report.txt",
    )

    assert result.url == "https://files.example/files/tools/report.txt?timestamp=1&sign=2&as_attachment=true"
    request = client.download_binding_file_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-workflow-valid-ref"
    assert request.execution_context.user_id == "authenticated-account"
    assert request.execution_context.user_from == "account"
    request_download.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="authenticated-account",
        user_from="account",
        invoke_from="debugger",
        file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:canonical"},
    )
    client.download_binding_file_sync.reset_mock()

    for node_execution_id in (
        "execution-cross-tenant",
        "execution-wrong-app",
        "execution-wrong-run",
        "execution-wrong-node",
        "execution-wrong-owner",
        "execution-retired",
    ):
        with pytest.raises(AgentSandboxInspectorError, match="active Workspace Binding"):
            service.download_file(
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_run_id="run-1",
                node_id="node-1",
                node_execution_id=node_execution_id,
                account_id="authenticated-account",
                path="report.txt",
            )

    client.download_binding_file_sync.assert_not_called()
    assert request_download.call_count == 1


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
    _add_build_draft_caller(
        sqlite_session,
        parent_app_id=parent_app_id,
        backing_app_id=backing_app_id,
        runtime_app_id=runtime_app_id,
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()
    response = BindingFileListResponse(path=".", entries=[], truncated=False)
    client.list_binding_files_sync.return_value = response

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
    client.list_binding_files_sync.assert_called_once_with("binding-build-ref", ".")


def test_workflow_file_access_uses_node_execution_pointer(
    sqlite_session: Session,
) -> None:
    binding = _add_binding(
        sqlite_session,
        binding_id="binding-workflow",
        workspace_id="workspace-workflow",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-1",
        owner_scope_key="node-1:workflow-binding-1",
    )
    sqlite_session.add(_workflow_execution(execution_id="execution-1", binding_id=binding.id))
    sqlite_session.commit()
    client = MagicMock()
    response = BindingFileReadResponse(path="report.txt", size=2, truncated=False, binary=False, text="ok")
    client.read_binding_file_sync.return_value = response

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
    client.read_binding_file_sync.assert_called_once_with("binding-workflow-ref", "report.txt")
    assert not sqlite_session.in_transaction()


def test_workflow_download_uses_authenticated_account_and_trusted_file_request(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    binding = _add_binding(
        sqlite_session,
        binding_id="binding-workflow",
        workspace_id="workspace-workflow",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-1",
        owner_scope_key="node-1:workflow-binding-1",
    )
    sqlite_session.add(_workflow_execution(execution_id="execution-1", binding_id=binding.id))
    sqlite_session.commit()
    events: list[str] = []

    @contextmanager
    def session_scope():
        with sqlite_session_factory() as service_session:
            yield service_session
            assert not service_session.in_transaction()
        events.append("session-exit")

    monkeypatch.setattr(sandbox_module.session_factory, "create_session", session_scope)
    client = MagicMock()
    client.download_binding_file_sync.side_effect = lambda _request: (
        events.append("client-download") or BindingFileDownloadResponse(reference="dify-file-ref:canonical")
    )
    request_download = MagicMock(
        side_effect=lambda **_kwargs: (
            events.append("file-request") or SimpleNamespace(download_uri="/files/tools/report.txt?timestamp=1&sign=2")
        )
    )
    monkeypatch.setattr(
        "services.agent_app_sandbox_service.FileRequestService",
        lambda: SimpleNamespace(request_download=request_download),
    )
    monkeypatch.setattr("services.agent_app_sandbox_service.dify_config.FILES_URL", "https://files.example")

    result = WorkflowAgentSandboxService(client_factory=lambda: nullcontext(client)).download_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        account_id="account-1",
        path="report.txt",
    )

    request = client.download_binding_file_sync.call_args.args[0]
    assert request.execution_context.user_id == "account-1"
    assert request.execution_context.user_from == "account"
    assert request.execution_context.node_execution_id == "execution-1"
    assert events == ["session-exit", "client-download", "file-request"]
    request_download.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="account-1",
        user_from="account",
        invoke_from="debugger",
        file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:canonical"},
    )
    assert result.url == "https://files.example/files/tools/report.txt?timestamp=1&sign=2&as_attachment=true"


def test_agent_app_download_uses_complete_account_context_after_session_exit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    events: list[str] = []
    _add_build_draft_caller(sqlite_session)
    sqlite_session.commit()

    @contextmanager
    def session_scope():
        with sqlite_session_factory() as service_session:
            yield service_session
        events.append("session-exit")

    monkeypatch.setattr(sandbox_module.session_factory, "create_session", session_scope)
    client = MagicMock()
    client.download_binding_file_sync.side_effect = lambda _request: (
        events.append("client-download") or BindingFileDownloadResponse(reference="dify-file-ref:canonical")
    )
    request_download = MagicMock(
        side_effect=lambda **_kwargs: (
            events.append("file-request") or SimpleNamespace(download_uri="/files/tools/report.txt?timestamp=1&sign=2")
        )
    )
    monkeypatch.setattr(
        sandbox_module,
        "FileRequestService",
        lambda: SimpleNamespace(request_download=request_download),
    )
    monkeypatch.setattr(sandbox_module.dify_config, "FILES_URL", "https://files.example")

    result = AgentAppSandboxService(client_factory=lambda: nullcontext(client)).download_file(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        caller_type="build_draft",
        caller_id="build-1",
        account_id="account-1",
        path="report.txt",
    )

    request = client.download_binding_file_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-build-ref"
    assert request.path == "report.txt"
    assert request.execution_context.model_dump(exclude_none=True) == {
        "tenant_id": "tenant-1",
        "user_id": "account-1",
        "user_from": "account",
        "app_id": "app-1",
        "agent_id": "agent-1",
        "agent_config_version_id": "config-1",
        "agent_config_version_kind": "draft",
        "agent_mode": "agent_app",
        "invoke_from": "debugger",
    }
    assert events == ["session-exit", "client-download", "file-request"]
    request_download.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="account-1",
        user_from="account",
        invoke_from="debugger",
        file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:canonical"},
    )
    assert result.url == "https://files.example/files/tools/report.txt?timestamp=1&sign=2&as_attachment=true"


def test_file_request_rejection_maps_to_download_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    request_download = MagicMock(side_effect=ValueError("reference is not accessible"))
    monkeypatch.setattr(
        sandbox_module,
        "FileRequestService",
        lambda: SimpleNamespace(request_download=request_download),
    )

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        sandbox_module._download_response(
            tenant_id="tenant-1",
            account_id="account-1",
            reference="dify-file-ref:untrusted",
        )

    assert exc_info.value.code == "binding_file_download_unavailable"
    assert exc_info.value.status_code == 502


@pytest.mark.parametrize(
    ("binding_id", "workflow_agent_binding_id"),
    [
        pytest.param(None, "workflow-binding-1", id="missing-binding-pointer"),
        pytest.param("binding-workflow", None, id="missing-process-data"),
    ],
)
def test_workflow_download_rejects_missing_binding_metadata_before_network(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    binding_id: str | None,
    workflow_agent_binding_id: str | None,
) -> None:
    sqlite_session.add(
        _workflow_execution(
            execution_id="execution-1",
            binding_id=binding_id,
            workflow_agent_binding_id=workflow_agent_binding_id,
        )
    )
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        WorkflowAgentSandboxService(client_factory=lambda: nullcontext(client)).download_file(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
            account_id="account-1",
            path="report.txt",
        )

    assert exc_info.value.code == "no_active_binding"
    client.download_binding_file_sync.assert_not_called()


def test_workflow_download_rejects_non_active_or_mismatched_binding_before_network(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    binding = _add_binding(
        sqlite_session,
        binding_id="binding-workflow",
        workspace_id="workspace-workflow",
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-other",
        owner_scope_key="node-1:workflow-binding-1",
    )
    sqlite_session.add(_workflow_execution(execution_id="execution-1", binding_id=binding.id))
    sqlite_session.commit()
    _use_session(monkeypatch, sqlite_session)
    client = MagicMock()

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        WorkflowAgentSandboxService(client_factory=lambda: nullcontext(client)).download_file(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
            account_id="account-1",
            path="report.txt",
        )

    assert exc_info.value.code == "no_active_binding"
    client.download_binding_file_sync.assert_not_called()
