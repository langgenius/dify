"""HTTP surface of knowledge-agent connections: MCP endpoint, OAuth endpoints, discovery."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from flask import Flask, Response

import controllers.mcp.knowledge_agent as module
from controllers import well_known
from services.knowledge_agent.access_service import (
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError

PRINCIPAL = KnowledgeAgentPrincipal(
    account_id="acct",
    tenant_id="tenant",
    grant_id="grant",
    token_id="token",
    kind="personal",
    client_name="CI",
    control_space_ids=("kb-1",),
)


class StubService:
    def __init__(self) -> None:
        self.auth: KnowledgeAgentPrincipal | KnowledgeAgentAuthFailure = PRINCIPAL
        self.tokens: list[str] = []
        self.exchanges: list[tuple[dict[str, object], KnowledgeAgentUrls]] = []
        self.revoked: list[dict[str, object]] = []

    def authenticate(self, token: str) -> KnowledgeAgentPrincipal | KnowledgeAgentAuthFailure:
        self.tokens.append(token)
        return self.auth

    def knowledge_bases_for(self, principal: KnowledgeAgentPrincipal) -> set[str]:
        return set(principal.control_space_ids)

    def exchange_token(self, form: dict[str, object], urls: KnowledgeAgentUrls) -> dict[str, object]:
        self.exchanges.append((form, urls))
        raise KnowledgeAgentOAuthError("invalid_grant", "The authorization code is invalid")

    def revoke_token(self, form: dict[str, object]) -> None:
        self.revoked.append(form)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> StubService:
    stub = StubService()
    monkeypatch.setattr(module, "knowledge_agent_access_service", lambda: stub)
    monkeypatch.setattr(module.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", True)
    monkeypatch.setattr(module.dify_config, "SERVICE_API_URL", "https://dify.test")
    monkeypatch.setattr(module.dify_config, "CONSOLE_WEB_URL", "https://cloud.dify.test")
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: SimpleNamespace(enabled=True))
    monkeypatch.setattr(
        module,
        "get_knowledge_fs_runtime",
        lambda _maker: SimpleNamespace(facade=object(), application=object()),
    )
    return stub


def _post(app: Flask, body: dict[str, object], headers: dict[str, str] | None = None) -> Response:
    with app.test_request_context(
        "/mcp/knowledge",
        method="POST",
        data=json.dumps(body),
        headers={"Content-Type": "application/json", **(headers or {})},
        base_url="https://dify.test",
    ):
        return module.KnowledgeAgentMcpApi().post()


def test_unauthenticated_requests_get_a_discovery_challenge(app: Flask, service: StubService) -> None:
    response = _post(app, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response.status_code == 401
    assert (
        'resource_metadata="https://dify.test/.well-known/oauth-protected-resource/mcp/knowledge"'
        in response.headers["WWW-Authenticate"]
    )
    assert service.tokens == []


def test_invalid_tokens_and_disabled_workspaces_are_refused(app: Flask, service: StubService) -> None:
    service.auth = KnowledgeAgentAuthFailure(401, "invalid_token")
    response = _post(app, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"Authorization": "Bearer dfok_x"})
    assert response.status_code == 401
    assert 'error="invalid_token"' in response.headers["WWW-Authenticate"]
    service.auth = KnowledgeAgentAuthFailure(403, "agent_access_disabled")
    response = _post(app, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"Authorization": "Bearer dfok_x"})
    assert response.status_code == 403


def test_tools_list_over_stateless_http(app: Flask, service: StubService) -> None:
    response = _post(
        app,
        {"jsonrpc": "2.0", "id": 7, "method": "tools/list"},
        {"Authorization": "Bearer dfok_token", "MCP-Protocol-Version": "2025-06-18"},
    )
    assert response.status_code == 200
    body = json.loads(response.get_data())
    assert body["id"] == 7
    assert len(body["result"]["tools"]) == 11
    assert service.tokens == ["dfok_token"]
    notification = _post(
        app, {"jsonrpc": "2.0", "method": "notifications/initialized"}, {"Authorization": "Bearer dfok_x"}
    )
    assert notification.status_code == 202


@pytest.mark.usefixtures("service")
def test_foreign_origins_get_and_delete_are_refused(app: Flask) -> None:
    foreign = _post(app, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"Origin": "https://evil.example"})
    assert foreign.status_code == 403
    allowed = _post(
        app,
        {"jsonrpc": "2.0", "id": 1, "method": "ping"},
        {"Origin": "https://cloud.dify.test", "Authorization": "Bearer dfok_x"},
    )
    assert allowed.status_code == 200
    with app.test_request_context("/mcp/knowledge", method="GET"):
        assert module.KnowledgeAgentMcpApi().get().status_code == 405
        assert module.KnowledgeAgentMcpApi().delete().status_code == 405


@pytest.mark.usefixtures("service")
def test_the_endpoint_disappears_when_the_deployment_switch_is_off(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", False)
    response = _post(app, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"Authorization": "Bearer dfok_x"})
    assert response.status_code == 404


def test_token_errors_use_the_oauth_error_shape(app: Flask, service: StubService) -> None:
    with app.test_request_context(
        "/mcp/knowledge/oauth/token",
        method="POST",
        data="grant_type=authorization_code&code=x&client_id=y",
        content_type="application/x-www-form-urlencoded",
    ):
        response = module.KnowledgeAgentTokenApi().post()
    assert response.status_code == 400
    assert json.loads(response.get_data()) == {
        "error": "invalid_grant",
        "error_description": "The authorization code is invalid",
    }
    form, urls = service.exchanges[0]
    assert form == {"grant_type": "authorization_code", "code": "x", "client_id": "y"}
    assert urls.token == "https://dify.test/mcp/knowledge/oauth/token"


def test_discovery_documents(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(well_known.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", True)
    monkeypatch.setattr(well_known.dify_config, "SERVICE_API_URL", "https://dify.test")
    monkeypatch.setattr(well_known.dify_config, "CONSOLE_WEB_URL", "https://cloud.dify.test")
    with app.test_request_context("/.well-known/oauth-protected-resource/mcp/knowledge"):
        resource = json.loads(well_known.oauth_protected_resource().get_data())
        server = json.loads(well_known.oauth_authorization_server().get_data())
    assert resource["resource"] == "https://dify.test/mcp/knowledge"
    assert server["authorization_endpoint"] == "https://cloud.dify.test/account/knowledge-agent/authorize"
    assert server["token_endpoint"] == "https://dify.test/mcp/knowledge/oauth/token"
    monkeypatch.setattr(well_known.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", False)
    with app.test_request_context("/.well-known/oauth-authorization-server"):
        assert well_known.oauth_authorization_server().status_code == 404


def test_revocation_always_answers_200(app: Flask, service: StubService) -> None:
    with app.test_request_context(
        "/mcp/knowledge/oauth/revoke",
        method="POST",
        data="token=dfokr_unknown",
        content_type="application/x-www-form-urlencoded",
    ):
        response = module.KnowledgeAgentRevokeApi().post()
    assert response.status_code == 200
    assert service.revoked == [{"token": "dfokr_unknown"}]
