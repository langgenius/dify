"""Unit tests for the Agent tool inner API controller."""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.inner_api import bp as inner_api_bp
from controllers.inner_api.agent import tools as tools_module
from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from tests.helpers.unit.config_override import config_overrides_context


@dataclass(slots=True)
class _AgentToolsStub:
    response: AgentToolInvokeResponse | None = None
    error: AgentToolInnerServiceError | None = None
    calls: list[tuple[Session, AgentToolInvokeRequest]] = field(default_factory=list)

    def invoke(self, *, session: Session, request: AgentToolInvokeRequest) -> AgentToolInvokeResponse:
        self.calls.append((session, request))
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


@dataclass(frozen=True, slots=True)
class _ApplicationServicesStub:
    agent_tools: _AgentToolsStub


@pytest.fixture
def agent_tools(monkeypatch: pytest.MonkeyPatch) -> _AgentToolsStub:
    service = _AgentToolsStub()
    services = _ApplicationServicesStub(agent_tools=service)
    monkeypatch.setattr(tools_module, "application_services", lambda: services)
    return service


def _headers(api_key: str | None = "inner-key") -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key is not None:
        headers["X-Inner-Api-Key"] = api_key
    return headers


def _payload() -> dict[str, object]:
    return {
        "caller": {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "app_id": "app-1",
            "invoke_from": "service-api",
            "conversation_id": "conversation-1",
            "workflow_id": "workflow-1",
            "workflow_run_id": "workflow-run-1",
            "node_id": "node-1",
            "node_execution_id": "node-exec-1",
            "agent_id": "agent-1",
            "agent_config_version_id": "snapshot-1",
        },
        "tool": {
            "provider_type": "plugin",
            "provider_id": "langgenius/search/search",
            "tool_name": "search",
            "credential_id": "credential-1",
            "tool_parameters": {"query": "dify"},
            "runtime_parameters": {"region": "us"},
        },
    }


@contextmanager
def _agent_inner_auth() -> Generator[None]:
    with (
        config_overrides_context(PLUGIN_DAEMON_KEY="plugin-daemon-key", INNER_API_KEY_FOR_PLUGIN="inner-key"),
    ):
        yield


def test_post_returns_service_response(agent_tools: _AgentToolsStub) -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with _agent_inner_auth():
        agent_tools.response = AgentToolInvokeResponse(
            messages=[{"type": "text", "message": {"text": "ok"}}],
            observation="ok",
            metadata={"provider_type": "plugin", "tool_name": "search"},
        )

        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json=_payload(),
            headers=_headers(),
        )

    assert response.status_code == 200
    body = response.get_json()
    assert body["observation"] == "ok"
    assert body["metadata"]["provider_type"] == "plugin"
    assert len(agent_tools.calls) == 1
    assert agent_tools.calls[0][1].caller.app_id == "app-1"


def test_post_returns_400_for_invalid_body() -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with _agent_inner_auth():
        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json={"caller": {}},
            headers=_headers(),
        )

    assert response.status_code == 400
    body = response.get_json()
    assert body["code"] == "invalid_request"


def test_post_preserves_service_error_status_code_and_description(
    agent_tools: _AgentToolsStub,
) -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)

    with _agent_inner_auth():
        agent_tools.error = AgentToolInnerServiceError(
            error_code="app_tenant_mismatch",
            description="App does not belong to the caller tenant.",
            status_code=403,
        )
        response = app.test_client().post(
            "/inner/api/agent/tools/invoke",
            json=_payload(),
            headers=_headers(),
        )

    assert response.status_code == 403
    body = response.get_json()
    assert body["code"] == "app_tenant_mismatch"
    assert body["message"] == "App does not belong to the caller tenant."
    assert len(agent_tools.calls) == 1
