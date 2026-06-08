from __future__ import annotations

from types import SimpleNamespace

import pytest

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError
from clients.agent_backend.workspace_files_client import (
    WorkspaceDownloadResult,
    WorkspaceFileEntry,
    WorkspaceListResult,
    WorkspacePreviewResult,
)
from controllers.console import agent_app_workspace as module
from services.agent_app_workspace_service import AgentWorkspaceInspectorError


def _unwrapped_get(resource_cls):
    func = resource_cls.get
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class _AgentAppService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str, str]] = []

    def list_files(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspaceListResult:
        self.calls.append(("list", tenant_id, app_id, conversation_id, path))
        return WorkspaceListResult(
            path=path,
            entries=[WorkspaceFileEntry(name="a.txt", type="file", size=3, mtime=10)],
            truncated=False,
        )

    def preview(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspacePreviewResult:
        self.calls.append(("preview", tenant_id, app_id, conversation_id, path))
        return WorkspacePreviewResult(path=path, size=5, truncated=False, binary=False, text="hello")

    def download(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspaceDownloadResult:
        self.calls.append(("download", tenant_id, app_id, conversation_id, path))
        return WorkspaceDownloadResult(path=path, size=3, truncated=False, content=b"abc")


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
    ) -> WorkspaceListResult:
        self.calls.append(("list", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return WorkspaceListResult(path=path, entries=[], truncated=False)

    def preview(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ) -> WorkspacePreviewResult:
        self.calls.append(("preview", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return WorkspacePreviewResult(path=path, size=5, truncated=False, binary=False, text="hello")

    def download(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ) -> WorkspaceDownloadResult:
        self.calls.append(("download", tenant_id, app_id, workflow_run_id, node_id, node_execution_id, path))
        return WorkspaceDownloadResult(path=path, size=3, truncated=False, content=b"abc")


def test_handle_maps_workspace_and_agent_backend_errors() -> None:
    assert module._handle(AgentWorkspaceInspectorError("no_sandbox", "no sandbox", status_code=404)) == (
        {"code": "no_sandbox", "message": "no sandbox"},
        404,
    )
    assert module._handle(
        AgentBackendHTTPError("not found", status_code=404, detail={"code": "not_found", "message": "missing"})
    ) == ({"code": "not_found", "message": "missing"}, 404)
    assert module._handle(AgentBackendHTTPError("bad", status_code=500, detail="backend exploded")) == (
        {"code": "agent_backend_error", "message": "backend exploded"},
        500,
    )
    assert module._handle(AgentBackendTransportError("connection refused")) == (
        {"code": "agent_backend_unreachable", "message": "connection refused"},
        502,
    )
    with pytest.raises(RuntimeError):
        module._handle(RuntimeError("boom"))


def test_download_response_returns_binary_or_too_large_error() -> None:
    response = module._download_response(
        WorkspaceDownloadResult(path="dir/report.txt", size=3, truncated=False, content=b"abc")
    )

    assert response.status_code == 200
    assert response.data == b"abc"
    assert response.headers["Content-Disposition"] == 'attachment; filename="report.txt"'
    assert response.headers["Content-Length"] == "3"
    assert response.headers["X-Workspace-File-Size"] == "3"

    assert module._download_response(WorkspaceDownloadResult(path="", size=10, truncated=True, content=b"")) == (
        {
            "code": "workspace_file_too_large",
            "message": (
                "file exceeds the workspace download limit; use preview for partial text or download a smaller file"
            ),
            "size": 10,
        },
        413,
    )


def test_agent_app_workspace_resources_proxy_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _AgentAppService()
    monkeypatch.setattr(module, "AgentAppWorkspaceService", lambda: service)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (None, "tenant-1"))
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(conversation_id="conv-1", path="sub/report.txt"),
    )
    app_model = SimpleNamespace(id="app-1")

    listing = _unwrapped_get(module.AgentAppWorkspaceListResource)(object(), app_model)
    preview = _unwrapped_get(module.AgentAppWorkspacePreviewResource)(object(), app_model)
    download = _unwrapped_get(module.AgentAppWorkspaceDownloadResource)(object(), app_model)

    assert listing["entries"][0]["name"] == "a.txt"
    assert preview["text"] == "hello"
    assert download.data == b"abc"
    assert service.calls == [
        ("list", "tenant-1", "app-1", "conv-1", "sub/report.txt"),
        ("preview", "tenant-1", "app-1", "conv-1", "sub/report.txt"),
        ("download", "tenant-1", "app-1", "conv-1", "sub/report.txt"),
    ]


def test_agent_app_workspace_resource_returns_normalized_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingService:
        def list_files(self, **kwargs):
            raise AgentWorkspaceInspectorError("no_active_session", "no active session", status_code=404)

    monkeypatch.setattr(module, "AgentAppWorkspaceService", FailingService)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (None, "tenant-1"))
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(conversation_id="conv-1", path="."),
    )

    assert _unwrapped_get(module.AgentAppWorkspaceListResource)(object(), SimpleNamespace(id="app-1")) == (
        {"code": "no_active_session", "message": "no active session"},
        404,
    )


def test_workflow_agent_workspace_resources_proxy_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _WorkflowService()
    monkeypatch.setattr(module, "WorkflowAgentWorkspaceService", lambda: service)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (None, "tenant-1"))
    monkeypatch.setattr(
        module,
        "query_params_from_request",
        lambda model: SimpleNamespace(node_execution_id="exec-1", path="out.txt"),
    )
    app_model = SimpleNamespace(id="app-1")

    listing = _unwrapped_get(module.WorkflowAgentWorkspaceListResource)(object(), app_model, "run-1", "agent-node")
    preview = _unwrapped_get(module.WorkflowAgentWorkspacePreviewResource)(object(), app_model, "run-1", "agent-node")
    download = _unwrapped_get(module.WorkflowAgentWorkspaceDownloadResource)(object(), app_model, "run-1", "agent-node")

    assert listing["path"] == "out.txt"
    assert preview["text"] == "hello"
    assert download.data == b"abc"
    assert service.calls == [
        ("list", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "out.txt"),
        ("preview", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "out.txt"),
        ("download", "tenant-1", "app-1", "run-1", "agent-node", "exec-1", "out.txt"),
    ]
