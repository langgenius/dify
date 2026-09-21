"""Sandbox ownership and network boundaries exercised with real short-lived SQLite sessions."""

import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Self, cast, override

import pytest
from dify_agent.client import Client
from dify_agent.protocol import (
    BindingFileDownloadRequest,
    BindingFileDownloadResponse,
    BindingFileListResponse,
    BindingFileReadResponse,
)
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowNodeExecutionStatus
from machinery.context import RequestContext
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
from models.model import App, AppMode, Conversation
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.agent_sandbox_repository import AgentSandboxRepository
from services.app.agent_app_contracts import (
    AgentAppNotFoundError,
    AgentSandboxBindingNotFoundError,
    AgentSandboxCaller,
    AgentSandboxDownloadUnavailableError,
    AgentSandboxUnavailableError,
    SandboxCaller,
    WorkflowSandboxAppNotFoundError,
    WorkflowSandboxCaller,
)
from services.app.agent_app_sandbox_service import AgentAppSandboxService
from services.app.agent_sandbox_file_gateway import AgentSandboxFileGateway, create_sandbox_client
from services.file_request_service import DownloadFileRequestResult, FileRequestService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_message

CONTEXT = RequestContext("request-1", "trace-1", "account-1", "tenant-1")


class RecordingClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.downloads: list[BindingFileDownloadRequest] = []

    def list_binding_files_sync(self, binding: str, path: str) -> BindingFileListResponse:
        self.calls.append(("list", binding, path))
        return BindingFileListResponse(path=path, entries=[], truncated=False)

    def read_binding_file_sync(self, binding: str, path: str) -> BindingFileReadResponse:
        self.calls.append(("read", binding, path))
        return BindingFileReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def download_binding_file_sync(self, request: BindingFileDownloadRequest) -> BindingFileDownloadResponse:
        self.downloads.append(request)
        return BindingFileDownloadResponse(reference="dify-file-ref:canonical")


class RecordingFileRequests:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.error: ValueError | None = None

    def request_download(self, **kwargs: object) -> DownloadFileRequestResult:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return DownloadFileRequestResult(
            filename="report.txt",
            mime_type="text/plain",
            size=5,
            download_uri="/files/tools/report.txt?timestamp=1&sign=2",
        )


@dataclass
class Sandbox:
    service: AgentAppSandboxService
    caller: SandboxCaller
    client: RecordingClient
    file_requests: RecordingFileRequests


@pytest.fixture(params=["conversation", "build_draft", "inline_build", "workflow", "advanced_chat"])
def sandbox(
    request: pytest.FixtureRequest, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> Sandbox:
    kind = request.param
    workflow = kind in ("workflow", "advanced_chat")
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Sandbox",
        mode=AppMode.ADVANCED_CHAT if kind == "advanced_chat" else AppMode.WORKFLOW if workflow else AppMode.AGENT,
        status="normal",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    sqlite_session.add(app)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Agent",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.WORKFLOW_ONLY if kind == "inline_build" else AgentScope.ROSTER,
        source=AgentSource.WORKFLOW if kind == "inline_build" else AgentSource.AGENT_APP,
        app_id="parent-app" if kind == "inline_build" else "app-1",
        backing_app_id="app-1" if kind == "inline_build" else None,
        workflow_id="workflow-1" if kind == "inline_build" else None,
        workflow_node_id="node-1" if kind == "inline_build" else None,
        status=AgentStatus.ACTIVE,
    )
    sqlite_session.add(agent)
    owner_type = (
        AgentWorkspaceOwnerType.WORKFLOW_RUN
        if workflow
        else (AgentWorkspaceOwnerType.CONVERSATION if kind == "conversation" else AgentWorkspaceOwnerType.BUILD_DRAFT)
    )
    owner_id = "run-1" if workflow else "caller-1"
    owner_scope = "node-1:workflow-binding-1" if workflow else "root"
    if kind == "advanced_chat":
        owner_type = AgentWorkspaceOwnerType.CONVERSATION
        owner_id = "caller-1"
        sqlite_session.add(
            make_message(
                message_id="message-1",
                app_id="app-1",
                conversation_id="caller-1",
                workflow_run_id="run-1",
                inputs={},
                query="query",
                answer="",
                message={},
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
    workspace = AgentWorkspace(
        id="workspace-1",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=owner_type,
        owner_id=owner_id,
        owner_scope_key=owner_scope,
        backend_workspace_ref="workspace-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    binding = AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT
        if workflow or kind == "conversation"
        else AgentConfigVersionKind.DRAFT,
        backend_binding_ref="binding-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        updated_at=datetime(2026, 8, 1),
    )
    # A newer binding must never replace the caller's explicit pointer.
    newer_binding = AgentWorkspaceBinding(
        id="binding-newer",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id="agent-1",
        agent_config_version_id="config-newer",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-newer-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        updated_at=datetime(2026, 8, 2),
    )
    sqlite_session.add_all([workspace, binding, newer_binding])
    if workflow:
        sqlite_session.add(
            WorkflowNodeExecutionModel(
                id="execution-1",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="workflow-1",
                workflow_run_id="run-1",
                node_id="node-1",
                node_type="agent",
                title="Agent",
                index=1,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                agent_workspace_binding_id="binding-1",
                process_data=json.dumps({"workflow_agent_binding_id": "workflow-binding-1"}),
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="historical-account",
            )
        )
        caller: SandboxCaller = WorkflowSandboxCaller("app-1", "run-1", "node-1", "execution-1")
    elif kind == "conversation":
        conversation = Conversation(
            id="caller-1",
            app_id="app-1",
            mode=AppMode.AGENT,
            name="Conversation",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-1",
            is_deleted=False,
            agent_workspace_binding_id="binding-1",
        )
        conversation._inputs = {}
        sqlite_session.add(conversation)
        caller = AgentSandboxCaller("agent-1", "conversation", "caller-1")
    else:
        sqlite_session.add(
            AgentConfigDraft(
                id="caller-1",
                tenant_id="tenant-1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id="account-1",
                draft_owner_key="account-1",
                agent_workspace_binding_id="binding-1",
                config_snapshot=AgentSoulConfig(),
            )
        )
        caller = AgentSandboxCaller("agent-1", "build_draft", "caller-1")
    sqlite_session.commit()

    sessions: list[Session] = []
    closed_sessions: set[Session] = set()

    class TrackingSession(Session):
        @override
        def __enter__(self) -> Self:
            sessions.append(self)
            return super().__enter__()

        @override
        def close(self) -> None:
            super().close()
            closed_sessions.add(self)

    factory = sessionmaker[Session](bind=sqlite_session_factory.kw["bind"], class_=TrackingSession)
    client = RecordingClient()
    files = RecordingFileRequests()

    @contextmanager
    def client_factory() -> Generator[Client, None, None]:
        assert sessions
        assert all(session in closed_sessions and not session.in_transaction() for session in sessions)
        yield cast(Client, client)

    apps = AgentAppRepository(session_factory=factory)
    service = AgentAppSandboxService(
        bindings=AgentSandboxRepository(session_factory=factory, apps=apps),
        files=AgentSandboxFileGateway(
            client_factory=client_factory,
            file_requests=cast(FileRequestService, files),
            files_url="https://files.example",
        ),
    )
    return Sandbox(service, caller, client, files)


def test_sandbox_network_uses_detached_binding_and_authenticated_actor(sandbox: Sandbox) -> None:
    service, caller = sandbox.service, sandbox.caller
    assert service.get_info(CONTEXT, caller).workspace_cwd == "."
    assert sandbox.client.calls == []
    assert service.list_files(CONTEXT, caller, "~/reports").path == "~/reports"
    assert service.read_file(CONTEXT, caller, "../report.txt").text == "hello"
    result = service.download_file(CONTEXT, caller, "/tmp/report.txt")
    assert sandbox.client.calls == [("list", "binding-ref", "~/reports"), ("read", "binding-ref", "../report.txt")]
    assert result.url == "https://files.example/files/tools/report.txt?timestamp=1&sign=2&as_attachment=true"
    [download] = sandbox.client.downloads
    assert download.backend_binding_ref == "binding-ref"
    assert download.path == "/tmp/report.txt"
    execution = download.execution_context
    assert execution.tenant_id == CONTEXT.active_workspace_id
    assert execution.user_id == CONTEXT.account_id
    assert execution.user_from == "account"
    assert execution.invoke_from == "debugger"
    assert execution.app_id == "app-1"
    assert execution.agent_id == "agent-1"
    assert execution.agent_config_version_id == "config-1"
    if isinstance(caller, AgentSandboxCaller):
        assert execution.agent_mode == "agent_app"
        assert execution.conversation_id == ("caller-1" if caller.caller_type == "conversation" else None)
        assert execution.agent_config_version_kind == ("snapshot" if caller.caller_type == "conversation" else "draft")
    else:
        assert execution.agent_mode == "workflow_run"
        assert execution.workflow_run_id == "run-1"
        assert execution.node_id == "node-1"
        assert execution.node_execution_id == "execution-1"
    assert sandbox.file_requests.calls == [
        {
            "tenant_id": "tenant-1",
            "user_id": "account-1",
            "user_from": "account",
            "invoke_from": "debugger",
            "file_mapping": {"transfer_method": "tool_file", "reference": "dify-file-ref:canonical"},
        }
    ]


@pytest.mark.parametrize(
    ("model", "attribute", "value"),
    [
        (AgentWorkspaceBinding, "tenant_id", "foreign"),
        (AgentWorkspaceBinding, "app_id", "foreign"),
        (AgentWorkspaceBinding, "status", AgentWorkingResourceStatus.RETIRED),
        (AgentWorkspaceBinding, "workspace_id", "missing"),
        (AgentWorkspace, "tenant_id", "foreign"),
        (AgentWorkspace, "app_id", "foreign"),
        (AgentWorkspace, "owner_id", "foreign"),
        (AgentWorkspace, "owner_scope_key", "foreign"),
        (AgentWorkspace, "status", AgentWorkingResourceStatus.RETIRED),
    ],
)
def test_sandbox_rejects_wrong_owner_or_inactive_binding(
    sandbox: Sandbox,
    sqlite_session: Session,
    model: type[AgentWorkspace] | type[AgentWorkspaceBinding],
    attribute: str,
    value: str,
) -> None:
    row = sqlite_session.get(model, "binding-1" if model is AgentWorkspaceBinding else "workspace-1")
    assert row is not None
    setattr(row, attribute, value)
    sqlite_session.commit()
    with pytest.raises(AgentSandboxBindingNotFoundError):
        sandbox.service.download_file(CONTEXT, sandbox.caller, "file")
    assert sandbox.client.downloads == []
    assert sandbox.file_requests.calls == []


@pytest.mark.parametrize(
    ("operation", "needs_path"),
    [
        (AgentAppSandboxService.get_info, False),
        (AgentAppSandboxService.list_files, True),
        (AgentAppSandboxService.read_file, True),
        (AgentAppSandboxService.download_file, True),
    ],
)
def test_sandbox_rejects_foreign_tenant_before_network(
    sandbox: Sandbox, operation: Callable[..., object], needs_path: bool
) -> None:
    context = CONTEXT._replace(active_workspace_id="foreign")
    args = (".",) if needs_path else ()
    with pytest.raises((AgentAppNotFoundError, WorkflowSandboxAppNotFoundError)):
        operation(sandbox.service, context, sandbox.caller, *args)
    assert sandbox.client.calls == sandbox.client.downloads == []


def test_sandbox_rejects_invalid_caller_metadata(sandbox: Sandbox, sqlite_session: Session) -> None:
    if isinstance(sandbox.caller, WorkflowSandboxCaller):
        row = sqlite_session.get(WorkflowNodeExecutionModel, "execution-1")
        assert row is not None
        row.process_data = "{}"
    elif sandbox.caller.caller_type == "conversation":
        row = sqlite_session.get(Conversation, "caller-1")
        assert row is not None
        row.is_deleted = True
    else:
        row = sqlite_session.get(AgentConfigDraft, "caller-1")
        assert row is not None
        row.draft_type = AgentConfigDraftType.DRAFT
    sqlite_session.commit()
    with pytest.raises(AgentSandboxBindingNotFoundError):
        sandbox.service.list_files(CONTEXT, sandbox.caller, ".")
    assert sandbox.client.calls == []


@pytest.mark.parametrize("sandbox", ["conversation", "build_draft", "inline_build"], indirect=True)
@pytest.mark.parametrize("invalid", ["account", "pointer", "agent"])
def test_agent_caller_is_account_scoped(sandbox: Sandbox, sqlite_session: Session, invalid: str) -> None:
    assert isinstance(sandbox.caller, AgentSandboxCaller)
    model = Conversation if sandbox.caller.caller_type == "conversation" else AgentConfigDraft
    row = sqlite_session.get(model, "caller-1")
    assert row is not None
    context = CONTEXT
    if invalid == "account":
        context = CONTEXT._replace(account_id="other")
    elif invalid == "pointer":
        row.agent_workspace_binding_id = None
    else:
        binding = sqlite_session.get(AgentWorkspaceBinding, "binding-1")
        assert binding is not None
        binding.agent_id = "other"
    sqlite_session.commit()
    with pytest.raises(AgentSandboxBindingNotFoundError):
        sandbox.service.download_file(context, sandbox.caller, "file")
    assert sandbox.client.downloads == []


@pytest.mark.parametrize("sandbox", ["workflow", "advanced_chat"], indirect=True)
@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_run_id", "node_id"])
def test_workflow_execution_owner_chain(sandbox: Sandbox, sqlite_session: Session, field: str) -> None:
    assert isinstance(sandbox.caller, WorkflowSandboxCaller)
    row = sqlite_session.get(WorkflowNodeExecutionModel, "execution-1")
    assert row is not None
    setattr(row, field, "foreign")
    sqlite_session.commit()
    with pytest.raises(AgentSandboxBindingNotFoundError):
        sandbox.service.read_file(CONTEXT, sandbox.caller, "file")
    assert sandbox.client.calls == []


def test_download_rejects_untrusted_tool_file_reference(sandbox: Sandbox) -> None:
    sandbox.file_requests.error = ValueError("not authorized")
    with pytest.raises(AgentSandboxDownloadUnavailableError):
        sandbox.service.download_file(CONTEXT, sandbox.caller, "file")


def test_missing_backend_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_BASE_URL="")
    with pytest.raises(AgentSandboxUnavailableError):
        create_sandbox_client()
