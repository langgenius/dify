from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace

import pytest
from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError, DifyAgentTimeoutError
from dify_agent.protocol import SandboxListResponse, SandboxReadResponse

from controllers.console import agent_app_sandbox as module
from models.model import App, AppMode, IconType
from services.agent_app_sandbox_service import AgentSandboxInfo, AgentSandboxInspectorError, AgentSandboxUploadDownload


class _AgentAppService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str, str]] = []

    def get_info(self, *, tenant_id: str, app_id: str, conversation_id: str) -> AgentSandboxInfo:
        self.calls.append(("info", tenant_id, app_id, conversation_id, ""))
        return AgentSandboxInfo(session_id="abc1234", workspace_cwd="~/workspace/abc1234")

    def list_files(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> SandboxListResponse:
        self.calls.append(("list", tenant_id, app_id, conversation_id, path))
        return SandboxListResponse(path=path, entries=[], truncated=False)

    def read_file(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> SandboxReadResponse:
        self.calls.append(("read", tenant_id, app_id, conversation_id, path))
        return SandboxReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def upload_file(
        self, *, tenant_id: str, app_id: str, conversation_id: str, path: str
    ) -> AgentSandboxUploadDownload:
        self.calls.append(("upload", tenant_id, app_id, conversation_id, path))
        return AgentSandboxUploadDownload(url="https://files.example/report.txt")


class _WorkflowService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str, str, str | None, str]] = []

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
        session,
    ) -> SandboxListResponse:
        self.calls.append(("list", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return SandboxListResponse(path=path, entries=[], truncated=False)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
        session,
    ) -> SandboxReadResponse:
        self.calls.append(("read", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return SandboxReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def upload_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
        session,
    ) -> AgentSandboxUploadDownload:
        self.calls.append(("upload", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return AgentSandboxUploadDownload(url="https://files.example/upload.txt")


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


def test_agent_app_sandbox_resources_proxy_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _AgentAppService()
    monkeypatch.setattr(module, "AgentAppSandboxService", lambda: service)
    monkeypatch.setattr(module, "resolve_agent_runtime_app_model", lambda *, tenant_id, agent_id: _app_model())
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(conversation_id="conv-1", path="sub/report.txt"),
    )
    monkeypatch.setattr(
        module,
        "request",
        SimpleNamespace(get_json=lambda silent=True: {"conversation_id": "conv-1", "path": "report.txt"}),
    )

    info = unwrap(module.AgentAppSandboxInfoResource.get)(object(), "tenant-1", "agent-1")
    listing = unwrap(module.AgentAppSandboxListResource.get)(object(), "tenant-1", "agent-1")
    preview = unwrap(module.AgentAppSandboxReadResource.get)(object(), "tenant-1", "agent-1")
    upload = unwrap(module.AgentAppSandboxUploadResource.post)(object(), "tenant-1", "agent-1")

    assert info == {"session_id": "abc1234", "workspace_cwd": "~/workspace/abc1234"}
    assert listing["path"] == "sub/report.txt"
    assert preview["text"] == "hello"
    assert upload == {"url": "https://files.example/report.txt"}
    assert service.calls == [
        ("info", "tenant-1", "app-1", "conv-1", ""),
        ("list", "tenant-1", "app-1", "conv-1", "sub/report.txt"),
        ("read", "tenant-1", "app-1", "conv-1", "sub/report.txt"),
        ("upload", "tenant-1", "app-1", "conv-1", "report.txt"),
    ]


def test_agent_app_sandbox_resource_returns_normalized_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingService:
        def get_info(self, **kwargs):
            raise AgentSandboxInspectorError("no_active_session", "no active session", status_code=404)

        def list_files(self, **kwargs):
            raise AgentSandboxInspectorError("no_active_session", "no active session", status_code=404)

    monkeypatch.setattr(module, "AgentAppSandboxService", FailingService)
    monkeypatch.setattr(module, "resolve_agent_runtime_app_model", lambda *, tenant_id, agent_id: _app_model())
    monkeypatch.setattr(
        module, "query_params_from_request", lambda model: SimpleNamespace(conversation_id="conv-1", path=".")
    )

    assert unwrap(module.AgentAppSandboxInfoResource.get)(object(), "tenant-1", "agent-1") == (
        {"code": "no_active_session", "message": "no active session"},
        404,
    )
    assert unwrap(module.AgentAppSandboxListResource.get)(object(), "tenant-1", "agent-1") == (
        {"code": "no_active_session", "message": "no active session"},
        404,
    )


def test_workflow_agent_sandbox_resources_proxy_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _WorkflowService()
    monkeypatch.setattr(module, "WorkflowAgentSandboxService", lambda: service)
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(node_execution_id="exec-1", path="out.txt"),
    )
    monkeypatch.setattr(
        module,
        "request",
        SimpleNamespace(get_json=lambda silent=True: {"node_execution_id": "exec-1", "path": "upload.txt"}),
    )
    app_model = _app_model()

    listing = unwrap(module.WorkflowAgentSandboxListResource.get)(
        object(), "tenant-1", app_model, "run-1", "agent-node"
    )
    preview = unwrap(module.WorkflowAgentSandboxReadResource.get)(
        object(), "tenant-1", app_model, "run-1", "agent-node"
    )
    upload = unwrap(module.WorkflowAgentSandboxUploadResource.post)(
        object(), "tenant-1", app_model, "run-1", "agent-node"
    )

    assert listing["path"] == "out.txt"
    assert preview["text"] == "hello"
    assert upload == {"url": "https://files.example/upload.txt"}
    assert service.calls == [
        ("list", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "out.txt"),
        ("read", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "out.txt"),
        ("upload", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "upload.txt"),
    ]
