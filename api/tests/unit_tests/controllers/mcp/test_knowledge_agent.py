"""HTTP surface of knowledge-agent connections: MCP endpoint, OAuth endpoints, discovery."""

from __future__ import annotations

import json
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from flask import Flask, Response
from sqlalchemy.orm import Session, sessionmaker

import controllers.mcp.knowledge_agent as module
from controllers import well_known
from services.knowledge_agent.access_service import (
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError
from tests.helpers.unit.knowledge_agent import World, authorize, code_form, knowledge_agent_world, register

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


# -- End to end: the real service behind the routes ------------------------------------------------


class DocumentFacade:
    """The one facade operation these tests reach, recording who it ran as."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def list_logical_documents(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(kwargs)
        document = SimpleNamespace(
            id="doc-1", title="Handbook", status="ready", enabled=True, active=None, updated_at="2026-11-01"
        )
        return SimpleNamespace(data=[document], next_cursor=None)


@pytest.fixture
def world(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[World, DocumentFacade]]:
    """The routes wired to the real access service over the service tests' doubles."""
    facade = DocumentFacade()
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)
    monkeypatch.setattr(module.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", True)
    monkeypatch.setattr(module.dify_config, "SERVICE_API_URL", "https://dify.test")
    monkeypatch.setattr(module.dify_config, "CONSOLE_WEB_URL", "https://cloud.dify.test")
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: SimpleNamespace(enabled=True))
    monkeypatch.setattr(
        module, "get_knowledge_fs_runtime", lambda _maker: SimpleNamespace(facade=facade, application=object())
    )
    with knowledge_agent_world(sqlite_session_factory) as built:
        monkeypatch.setattr(module, "knowledge_agent_access_service", lambda: built.service)
        yield built, facade


def _call_tool(app: Flask, token: str, name: str, arguments: dict[str, object]) -> Response:
    return _post(
        app,
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        {"Authorization": f"Bearer {token}"},
    )


def _token_request(app: Flask, form: dict[str, str]) -> Response:
    with app.test_request_context("/mcp/knowledge/oauth/token", method="POST", data=form, base_url="https://dify.test"):
        return module.KnowledgeAgentTokenApi().post()


def test_a_personal_token_reads_its_bases_and_nothing_else_until_it_is_revoked(
    app: Flask, world: tuple[World, DocumentFacade]
) -> None:
    built, facade = world
    created = built.service.create_personal_token(
        account=built.member_account, tenant_id=built.tenant, body={"name": "CI", "knowledge_base_ids": ["kb-handbook"]}
    )
    token = created["token"]

    listed = _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"})
    assert listed.status_code == 200
    result = json.loads(listed.get_data())["result"]
    assert result["structuredContent"]["documents"][0]["id"] == "doc-1"
    assert facade.calls == [
        {
            "tenant_id": built.tenant,
            "account_id": built.member,
            "control_space_id": "kb-handbook",
            "cursor": None,
            "limit": 50,
        }
    ]

    # A base the member can read but did not choose for this token, under either spelling.
    spellings: list[dict[str, object]] = [{"knowledgeBaseId": "kb-finance"}, {"knowledge_base_id": "kb-finance"}]
    for arguments in spellings:
        refused = json.loads(_call_tool(app, token, "list_documents", arguments).get_data())["result"]
        assert refused["isError"] is True
    assert len(facade.calls) == 1

    built.service.revoke_grant(
        account=built.member_account, tenant_id=built.tenant, role="normal", grant_id=created["grant"]["id"]
    )
    revoked = _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"})
    assert revoked.status_code == 401
    assert 'error="invalid_token"' in revoked.headers["WWW-Authenticate"]
    assert json.loads(revoked.get_data())["error"] == "invalid_token"
    assert len(facade.calls) == 1


def test_the_token_endpoint_redeems_a_code_once_and_a_replay_ends_the_connection(
    app: Flask, world: tuple[World, DocumentFacade]
) -> None:
    built, _ = world
    flow = authorize(built, client_id=register(built), spaces=["kb-handbook"])

    issued = _token_request(app, code_form(flow))
    assert issued.status_code == 200
    assert issued.headers["Cache-Control"] == "no-store"
    assert issued.headers["Pragma"] == "no-cache"
    tokens = json.loads(issued.get_data())
    assert tokens["token_type"] == "Bearer"
    assert tokens["scope"] == "knowledge:read"
    assert (
        _call_tool(app, tokens["access_token"], "list_documents", {"knowledgeBaseId": "kb-handbook"}).status_code == 200
    )

    replay = _token_request(app, code_form(flow))
    assert replay.status_code == 400
    assert json.loads(replay.get_data()) == {
        "error": "invalid_grant",
        "error_description": "The authorization code was already used",
    }
    after = _call_tool(app, tokens["access_token"], "list_documents", {"knowledgeBaseId": "kb-handbook"})
    assert after.status_code == 401


@pytest.mark.usefixtures("world")
def test_registration_answers_201_and_reports_bad_metadata_and_the_rate_limit(app: Flask) -> None:
    def post(body: object) -> Response:
        with app.test_request_context(
            "/mcp/knowledge/oauth/register",
            method="POST",
            json=body,
            environ_base={"REMOTE_ADDR": "10.1.1.1"},
        ):
            return module.KnowledgeAgentRegisterApi().post()

    created = post({"client_name": "Codex", "redirect_uris": ["http://localhost/callback"]})
    assert created.status_code == 201
    registered = json.loads(created.get_data())
    assert registered["client_id"].startswith("dfokc_")
    assert registered["client_name"] == "Codex"

    bad = post({"redirect_uris": ["http://evil.example/cb"]})
    assert bad.status_code == 400
    assert json.loads(bad.get_data())["error"] == "invalid_redirect_uri"

    limited = None
    for _ in range(25):
        limited = post({"redirect_uris": ["http://localhost/callback"]})
        if limited.status_code != 201:
            break
    assert limited is not None
    assert limited.status_code == 429
    assert json.loads(limited.get_data())["error"] == "slow_down"
