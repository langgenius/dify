"""Transport parsing, permission declarations and sandbox error serialization."""

from collections.abc import Callable
from dataclasses import dataclass
from inspect import unwrap
from uuid import UUID

import pytest
from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError, DifyAgentTimeoutError
from dify_agent.protocol import BindingFileListResponse, BindingFileReadResponse
from flask import Flask
from flask_restx import Resource

from controllers.console import agent_app_sandbox as module
from machinery.context import RequestContext
from services.agent.errors import AgentNotFoundError
from services.app.agent_app_contracts import (
    AgentAppNotFoundError,
    AgentSandboxBindingNotFoundError,
    AgentSandboxCaller,
    AgentSandboxDownload,
    AgentSandboxDownloadUnavailableError,
    AgentSandboxInfo,
    AgentSandboxUnavailableError,
    SandboxCaller,
    WorkflowSandboxAppNotFoundError,
    WorkflowSandboxCaller,
)
from tests.unit_tests.controllers.rbac_introspection import rbac_checks

CONTEXT = RequestContext("request", "trace", "actor", "workspace")
RESOURCE_ID = UUID("11111111-1111-1111-1111-111111111111")


class SandboxService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, RequestContext, SandboxCaller, str]] = []
        self.error: Exception | None = None

    def record(self, operation: str, context: RequestContext, caller: SandboxCaller, path: str = "") -> None:
        self.calls.append((operation, context, caller, path))
        if self.error:
            raise self.error

    def get_info(self, context: RequestContext, caller: SandboxCaller) -> AgentSandboxInfo:
        self.record("info", context, caller)
        return AgentSandboxInfo(workspace_cwd=".")

    def list_files(self, context: RequestContext, caller: SandboxCaller, path: str) -> BindingFileListResponse:
        self.record("list", context, caller, path)
        return BindingFileListResponse(path=path, entries=[], truncated=False)

    def read_file(self, context: RequestContext, caller: SandboxCaller, path: str) -> BindingFileReadResponse:
        self.record("read", context, caller, path)
        return BindingFileReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def download_file(self, context: RequestContext, caller: SandboxCaller, path: str) -> AgentSandboxDownload:
        self.record("download", context, caller, path)
        return AgentSandboxDownload(url="https://files.example/report.txt")


@dataclass
class AgentServices:
    sandbox: SandboxService


@dataclass
class Services:
    agent_apps: AgentServices


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> SandboxService:
    service = SandboxService()
    monkeypatch.setattr(module, "application_services", lambda: Services(AgentServices(service)))
    return service


@pytest.mark.parametrize(
    ("resource", "method", "verb", "operation", "workflow"),
    [
        (module.AgentAppSandboxInfoResource, module.AgentAppSandboxInfoResource.get, "get", "info", False),
        (module.AgentAppSandboxListResource, module.AgentAppSandboxListResource.get, "get", "list", False),
        (module.AgentAppSandboxReadResource, module.AgentAppSandboxReadResource.get, "get", "read", False),
        (
            module.AgentAppSandboxDownloadResource,
            module.AgentAppSandboxDownloadResource.post,
            "post",
            "download",
            False,
        ),
        (module.WorkflowAgentSandboxListResource, module.WorkflowAgentSandboxListResource.get, "get", "list", True),
        (module.WorkflowAgentSandboxReadResource, module.WorkflowAgentSandboxReadResource.get, "get", "read", True),
        (
            module.WorkflowAgentSandboxDownloadResource,
            module.WorkflowAgentSandboxDownloadResource.post,
            "post",
            "download",
            True,
        ),
    ],
)
def test_controller_parses_and_serializes(
    app: Flask,
    service: SandboxService,
    resource: type[Resource],
    method: Callable[..., object],
    verb: str,
    operation: str,
    workflow: bool,
) -> None:
    payload = {"node_execution_id": "execution"} if workflow else {"caller_type": "build_draft", "caller_id": "draft"}
    if operation != "info":
        payload["path"] = "~/report.txt"
    kwargs = {"json": payload} if verb == "post" else {"query_string": payload}
    params = (RESOURCE_ID, RESOURCE_ID, "node") if workflow else (RESOURCE_ID,)
    with app.test_request_context("/", method=verb.upper(), **kwargs):
        result = unwrap(method)(resource(), CONTEXT, *params)
    caller = (
        WorkflowSandboxCaller(str(RESOURCE_ID), str(RESOURCE_ID), "node", "execution")
        if workflow
        else (AgentSandboxCaller(str(RESOURCE_ID), "build_draft", "draft"))
    )
    assert service.calls == [(operation, CONTEXT, caller, "" if operation == "info" else "~/report.txt")]
    if operation == "info":
        assert result == {"workspace_cwd": "."}
    elif operation == "download":
        assert result == {"url": "https://files.example/report.txt"}
    elif operation == "read":
        assert result == {"path": "~/report.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"}
    else:
        assert result == {"path": "~/report.txt", "entries": [], "truncated": False}

    [check] = rbac_checks(method)
    if workflow:
        assert isinstance(check.locator, module.PlainApp)
        assert check.scene == module.RBACPermission.APP_VIEW_LAYOUT
    else:
        assert isinstance(check.locator, module.AgentId)
        assert check.scene == (
            module.RBACPermission.AGENT_EDIT if operation == "download" else module.RBACPermission.AGENT_PREVIEW
        )


@pytest.mark.parametrize(
    ("error", "code", "message", "status"),
    [
        (AgentSandboxBindingNotFoundError("no active binding"), "no_active_binding", "no active binding", 404),
        (AgentSandboxUnavailableError("unavailable"), "inspector_unavailable", "unavailable", 503),
        (
            AgentSandboxDownloadUnavailableError("cannot download"),
            "binding_file_download_unavailable",
            "cannot download",
            502,
        ),
        (DifyAgentHTTPError(409, {"code": "conflict", "message": "busy"}), "conflict", "busy", 409),
        (DifyAgentHTTPError(500, "backend exploded"), "agent_backend_error", "backend exploded", 500),
        (DifyAgentTimeoutError("connection refused"), "agent_backend_unreachable", "connection refused", 502),
        (DifyAgentClientError("transport failed"), "agent_backend_unreachable", "transport failed", 502),
    ],
)
def test_sandbox_error_responses(
    app: Flask, service: SandboxService, error: Exception, code: str, message: str, status: int
) -> None:
    service.error = error
    with app.test_request_context("/?caller_type=conversation&caller_id=conversation"):
        result = unwrap(module.AgentAppSandboxInfoResource.get)(object(), CONTEXT, RESOURCE_ID)
    assert result == ({"code": code, "message": message}, status)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (AgentAppNotFoundError(), AgentNotFoundError),
        (WorkflowSandboxAppNotFoundError(), module.AppNotFoundError),
        (RuntimeError("unexpected"), RuntimeError),
    ],
)
def test_resource_errors_keep_existing_http_contract(error: Exception, expected: type[Exception]) -> None:
    with pytest.raises(expected):
        module._handle(error)
