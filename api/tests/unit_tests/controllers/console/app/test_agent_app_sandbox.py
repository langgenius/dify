from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError, DifyAgentTimeoutError
from dify_agent.protocol import BindingFileListResponse, BindingFileReadResponse
from sqlalchemy.orm import Session

from controllers.console import agent_app_sandbox as module
from models.model import App, AppMode, IconType
from services.agent_app_sandbox_service import AgentSandboxDownload, AgentSandboxInfo, AgentSandboxInspectorError


class _AgentAppService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str, str, str, str, str]] = []

    def get_info(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: str,
        caller_id: str,
        account_id: str,
    ) -> AgentSandboxInfo:
        self.calls.append(("info", tenant_id, app_id, agent_id, caller_type, caller_id, account_id, ""))
        return AgentSandboxInfo(workspace_cwd=".")

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: str,
        caller_id: str,
        account_id: str,
        path: str,
    ) -> BindingFileListResponse:
        self.calls.append(("list", tenant_id, app_id, agent_id, caller_type, caller_id, account_id, path))
        return BindingFileListResponse(path=path, entries=[], truncated=False)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: str,
        caller_id: str,
        account_id: str,
        path: str,
    ) -> BindingFileReadResponse:
        self.calls.append(("read", tenant_id, app_id, agent_id, caller_type, caller_id, account_id, path))
        return BindingFileReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def download_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: str,
        caller_id: str,
        account_id: str,
        path: str,
    ) -> AgentSandboxDownload:
        self.calls.append(("download", tenant_id, app_id, agent_id, caller_type, caller_id, account_id, path))
        return AgentSandboxDownload(url="https://files.example/report.txt")


class _WorkflowService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        path: str,
        session,
    ) -> BindingFileListResponse:
        self.calls.append(("list", tenant_id, app_id, workflow_run_id, node_id, path))
        return BindingFileListResponse(path=path, entries=[], truncated=False)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        path: str,
        session,
    ) -> BindingFileReadResponse:
        self.calls.append(("read", tenant_id, app_id, workflow_run_id, node_id, path))
        return BindingFileReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def download_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        account_id: str,
        path: str,
    ) -> AgentSandboxDownload:
        self.calls.append(("download", tenant_id, app_id, workflow_run_id, node_id, account_id, path))
        return AgentSandboxDownload(url="https://files.example/download.txt")


def _app_model(app_id: str = "app-1") -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name="App",
        mode=AppMode.AGENT,
        icon_type=IconType.EMOJI,
        icon="bot",
        icon_background="#fff",
        enable_site=False,
        enable_api=False,
    )


def test_handle_maps_sandbox_and_agent_backend_errors() -> None:
    assert module._handle(AgentSandboxInspectorError("no_sandbox", "no sandbox", status_code=404)) == (
        {"code": "no_sandbox", "message": "no sandbox"},
        404,
    )
    assert module._handle(DifyAgentHTTPError(404, {"code": "sandbox_path_not_found", "message": "missing"})) == (
        {"code": "sandbox_path_not_found", "message": "missing"},
        404,
    )
    assert module._handle(DifyAgentHTTPError(500, "backend exploded")) == (
        {"code": "agent_backend_error", "message": "backend exploded"},
        500,
    )
    assert module._handle(DifyAgentTimeoutError("connection refused")) == (
        {"code": "agent_backend_unreachable", "message": "connection refused"},
        502,
    )
    assert module._handle(DifyAgentClientError("transport failed")) == (
        {"code": "agent_backend_unreachable", "message": "transport failed"},
        502,
    )
    with pytest.raises(RuntimeError):
        module._handle(RuntimeError("boom"))


def test_agent_app_sandbox_resources_proxy_service(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    service = _AgentAppService()
    session = unbound_session
    account = SimpleNamespace(id="account-1")
    resolver = MagicMock(return_value=_app_model())
    monkeypatch.setattr(module, "AgentAppSandboxService", lambda: service)
    monkeypatch.setattr(module, "resolve_agent_runtime_app_model", resolver)
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(caller_type="build_draft", caller_id="build-1", path="sub/report.txt"),
    )
    download_context = MagicMock()
    download_session = download_context.__enter__.return_value
    monkeypatch.setattr(module.session_factory, "create_session", lambda: download_context)

    info = unwrap(module.AgentAppSandboxInfoResource.get)(object(), session, account, "tenant-1", "agent-1")
    listing = unwrap(module.AgentAppSandboxListResource.get)(object(), session, account, "tenant-1", "agent-1")
    preview = unwrap(module.AgentAppSandboxReadResource.get)(object(), session, account, "tenant-1", "agent-1")
    req_data = module.AgentSandboxDownloadPayload.model_validate(
        {"caller_type": "build_draft", "caller_id": "build-1", "path": "report.txt"}
    )
    download = unwrap(module.AgentAppSandboxDownloadResource.post)(object(), req_data, account, "tenant-1", "agent-1")

    assert info == {"workspace_cwd": "."}
    assert listing["path"] == "sub/report.txt"
    assert preview["text"] == "hello"
    assert download == {"url": "https://files.example/report.txt"}
    assert service.calls == [
        ("info", "tenant-1", "app-1", "agent-1", "build_draft", "build-1", "account-1", ""),
        ("list", "tenant-1", "app-1", "agent-1", "build_draft", "build-1", "account-1", "sub/report.txt"),
        ("read", "tenant-1", "app-1", "agent-1", "build_draft", "build-1", "account-1", "sub/report.txt"),
        ("download", "tenant-1", "app-1", "agent-1", "build_draft", "build-1", "account-1", "report.txt"),
    ]
    assert all(call.kwargs["session"] is session for call in resolver.call_args_list[:3])
    assert resolver.call_args_list[3].kwargs["session"] is download_session


def test_agent_app_sandbox_resource_returns_normalized_errors(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    class FailingService:
        def get_info(self, **kwargs):
            raise AgentSandboxInspectorError("no_active_binding", "no active binding", status_code=404)

        def list_files(self, **kwargs):
            raise AgentSandboxInspectorError("no_active_binding", "no active binding", status_code=404)

    monkeypatch.setattr(module, "AgentAppSandboxService", FailingService)
    session = unbound_session
    account = SimpleNamespace(id="account-1")
    monkeypatch.setattr(module, "resolve_agent_runtime_app_model", MagicMock(return_value=_app_model()))
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(caller_type="conversation", caller_id="conv-1", path="."),
    )

    assert unwrap(module.AgentAppSandboxInfoResource.get)(object(), session, account, "tenant-1", "agent-1") == (
        {"code": "no_active_binding", "message": "no active binding"},
        404,
    )
    assert unwrap(module.AgentAppSandboxListResource.get)(object(), session, account, "tenant-1", "agent-1") == (
        {"code": "no_active_binding", "message": "no active binding"},
        404,
    )


def test_workflow_agent_sandbox_resources_proxy_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _WorkflowService()
    monkeypatch.setattr(module, "WorkflowAgentSandboxService", lambda: service)
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(node_execution_id="execution-1", path="out.txt"),
    )
    app_model = _app_model()
    download_context = MagicMock()
    download_context.__enter__.return_value.scalar.return_value = app_model
    monkeypatch.setattr(module.session_factory, "create_session", lambda: download_context)

    listing = unwrap(module.WorkflowAgentSandboxListResource.get)(
        object(), "tenant-1", app_model, "run-1", "agent-node"
    )
    preview = unwrap(module.WorkflowAgentSandboxReadResource.get)(
        object(), "tenant-1", app_model, "run-1", "agent-node"
    )
    req_data = module.WorkflowAgentSandboxDownloadPayload.model_validate(
        {"node_execution_id": "execution-1", "path": "download.txt"}
    )
    account = SimpleNamespace(id="account-1")
    download = unwrap(module.WorkflowAgentSandboxDownloadResource.post)(
        object(), req_data, "tenant-1", account, "app-1", "run-1", "agent-node"
    )

    assert listing["path"] == "out.txt"
    assert preview["text"] == "hello"
    assert download == {"url": "https://files.example/download.txt"}
    assert service.calls == [
        ("list", "tenant-1", "app-1", "run-1", "agent-node", "out.txt"),
        ("read", "tenant-1", "app-1", "run-1", "agent-node", "out.txt"),
        ("download", "tenant-1", "app-1", "run-1", "agent-node", "account-1", "download.txt"),
    ]


def test_download_route_session_scopes_exit_before_service_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []

    class RecordingContext:
        def __init__(self, session: MagicMock, label: str) -> None:
            self.session = session
            self.label = label

        def __enter__(self) -> MagicMock:
            return self.session

        def __exit__(self, *_args: object) -> None:
            events.append(f"{self.label}-exit")

    agent_session = MagicMock()
    workflow_session = MagicMock()
    workflow_session.scalar.return_value = _app_model()
    contexts = iter(
        [
            RecordingContext(agent_session, "agent-app"),
            RecordingContext(workflow_session, "workflow-app"),
        ]
    )
    monkeypatch.setattr(module.session_factory, "create_session", lambda: next(contexts))
    monkeypatch.setattr(module, "resolve_agent_runtime_app_model", lambda **_kwargs: _app_model())

    class RecordingAgentService(_AgentAppService):
        def download_file(self, **kwargs) -> AgentSandboxDownload:
            events.append("agent-download")
            return super().download_file(**kwargs)

    class RecordingWorkflowService(_WorkflowService):
        def download_file(self, **kwargs) -> AgentSandboxDownload:
            events.append("workflow-download")
            return super().download_file(**kwargs)

    monkeypatch.setattr(module, "AgentAppSandboxService", RecordingAgentService)
    monkeypatch.setattr(module, "WorkflowAgentSandboxService", RecordingWorkflowService)
    account = SimpleNamespace(id="account-1")
    agent_payload = module.AgentSandboxDownloadPayload(
        caller_type="build_draft", caller_id="build-1", path="report.txt"
    )
    workflow_payload = module.WorkflowAgentSandboxDownloadPayload(node_execution_id="execution-1", path="report.txt")

    unwrap(module.AgentAppSandboxDownloadResource.post)(object(), agent_payload, account, "tenant-1", "agent-1")
    unwrap(module.WorkflowAgentSandboxDownloadResource.post)(
        object(), workflow_payload, "tenant-1", account, "app-1", "run-1", "agent-node"
    )

    assert events == ["agent-app-exit", "agent-download", "workflow-app-exit", "workflow-download"]
