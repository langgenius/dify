"""HTTP surface of knowledge-agent connections: MCP endpoint, OAuth endpoints, discovery."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Iterator
from typing import TYPE_CHECKING

import pytest
from flask import Flask, Response
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.test import EnvironBuilder

import controllers.mcp.knowledge_agent as module
from controllers import well_known
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.clients import DCR_GLOBAL_PER_HOUR, DCR_RATE_WINDOW_SECONDS
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError
from services.knowledge_fs.product_dto import KnowledgeFSLogicalDocumentListResponse
from tests.helpers.unit.knowledge_agent import (
    FakeKnowledgeFacade,
    FakeKnowledgeRuntime,
    World,
    authorize,
    code_form,
    knowledge_agent_world,
    knowledge_fs_features,
    register,
)

if TYPE_CHECKING:
    from _typeshed.wsgi import StartResponse, WSGIEnvironment

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

    def knowledge_bases_for(
        self, principal: KnowledgeAgentPrincipal, *, among: Iterable[str] | None = None
    ) -> set[str]:
        granted = set(principal.control_space_ids)
        return granted if among is None else granted & set(among)

    def require_enabled(self) -> None:
        return None

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
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))
    monkeypatch.setattr(
        module,
        "get_knowledge_fs_runtime",
        lambda _maker: FakeKnowledgeRuntime(facade=FakeKnowledgeFacade()),
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


def _document_facade() -> FakeKnowledgeFacade:
    """The facade answering the one operation these tests reach; it records who each call ran as."""
    facade = FakeKnowledgeFacade()
    facade.answers["list_logical_documents"] = KnowledgeFSLogicalDocumentListResponse.model_validate(
        {
            "data": [
                {
                    "active": None,
                    "createdAt": "2026-10-01T08:00:00Z",
                    "id": "doc-1",
                    "knowledgeSpaceId": "space-1",
                    "rowVersion": 1,
                    "status": "ready",
                    "title": "Handbook",
                    "updatedAt": "2026-11-01T00:00:00Z",
                    "userMetadata": {},
                }
            ],
            "nextCursor": None,
        }
    )
    return facade


@pytest.fixture
def world(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[World, FakeKnowledgeFacade]]:
    """The routes wired to the real access service over the service tests' doubles."""
    facade = _document_facade()
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)
    monkeypatch.setattr(module.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", True)
    monkeypatch.setattr(module.dify_config, "SERVICE_API_URL", "https://dify.test")
    monkeypatch.setattr(module.dify_config, "CONSOLE_WEB_URL", "https://cloud.dify.test")
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))
    monkeypatch.setattr(module, "get_knowledge_fs_runtime", lambda _maker: FakeKnowledgeRuntime(facade=facade))
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
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
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
        (
            "list_logical_documents",
            {
                "tenant_id": built.tenant,
                "account_id": built.member,
                "control_space_id": "kb-handbook",
                "cursor": None,
                "limit": 50,
            },
        )
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
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
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
    assert limited.headers["Retry-After"] == str(DCR_RATE_WINDOW_SECONDS)
    assert limited.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in bad.headers


def test_registration_reports_the_deployment_wide_ceiling_with_retry_after(
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
) -> None:
    built, _ = world
    built.redis.set("knowledge_agent:dcr-global", str(DCR_GLOBAL_PER_HOUR), ex=1500, nx=True)
    with app.test_request_context(
        "/mcp/knowledge/oauth/register",
        method="POST",
        json={"redirect_uris": ["http://localhost/callback"]},
        environ_base={"REMOTE_ADDR": "10.1.1.1"},
    ):
        refused = module.KnowledgeAgentRegisterApi().post()
    assert refused.status_code == 429
    assert refused.headers["Retry-After"] == "1500"
    assert json.loads(refused.get_data()) == {
        "error": "temporarily_unavailable",
        "error_description": "Client registration is temporarily unavailable; try again later",
    }


def test_registration_is_limited_by_the_address_the_shared_helper_reports(
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
) -> None:
    """``extract_remote_ip`` is the WSGI address: forwarded only when the proxy middleware is on."""
    built, _ = world

    def environ() -> WSGIEnvironment:
        return EnvironBuilder(
            "/mcp/knowledge/oauth/register",
            method="POST",
            json={"redirect_uris": ["http://localhost/callback"]},
            headers=[("X-Forwarded-For", "203.0.113.9")],
            environ_base={"REMOTE_ADDR": "172.18.0.5"},
        ).get_environ()

    def register_app(environ: WSGIEnvironment, _start_response: StartResponse) -> Iterable[bytes]:
        with app.request_context(environ):
            assert module.KnowledgeAgentRegisterApi().post().status_code == 201
        return []

    def _ignore_start(*_args: object) -> Callable[[bytes], object]:
        return lambda _data: None

    # Default deployment: the header is not trusted, the key is the proxy's socket address.
    register_app(environ(), _ignore_start)
    assert built.redis.values["knowledge_agent:dcr:172.18.0.5"] == 1
    assert "knowledge_agent:dcr:203.0.113.9" not in built.redis.values

    # RESPECT_XFORWARD_HEADERS_ENABLED installs exactly this middleware (extensions/ext_proxy_fix.py).
    ProxyFix(register_app, x_for=1, x_port=1)(environ(), _ignore_start)
    assert built.redis.values["knowledge_agent:dcr:203.0.113.9"] == 1
    assert built.redis.values["knowledge_agent:dcr:172.18.0.5"] == 1


# -- Public URLs and the Host header -----------------------------------------------------------------


def _post_from(app: Flask, *, host: str, origin: str | None) -> Response:
    """A `ping` reaching the endpoint under ``host`` (what the caller put in the Host header)."""
    headers = {"Content-Type": "application/json", "Authorization": "Bearer dfok_x"}
    if origin is not None:
        headers["Origin"] = origin
    with app.test_request_context(
        "/mcp/knowledge",
        method="POST",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}),
        headers=headers,
        base_url=host,
    ):
        return module.KnowledgeAgentMcpApi().post()


@pytest.mark.usefixtures("service")
def test_the_request_host_never_enters_the_origin_allow_list(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: the Host header was allow-listed, so a rebinding page (Origin == Host) got through."""
    # Configured: only the configured origins, whatever host the request names.
    rebinding = _post_from(app, host="http://attacker.example:5001", origin="http://attacker.example:5001")
    assert rebinding.status_code == 403
    assert json.loads(rebinding.get_data())["error"] == "forbidden_origin"
    assert _post_from(app, host="http://attacker.example:5001", origin="https://cloud.dify.test").status_code == 200
    assert _post_from(app, host="https://dify.test", origin="https://dify.test/").status_code == 200
    assert _post_from(app, host="https://dify.test", origin="http://localhost:3000").status_code == 403

    # Nothing configured: still not the request host; loopback origins and CLI agents keep working.
    monkeypatch.setattr(module.dify_config, "SERVICE_API_URL", "")
    monkeypatch.setattr(module.dify_config, "CONSOLE_WEB_URL", "")
    assert (
        _post_from(app, host="http://attacker.example:5001", origin="http://attacker.example:5001").status_code == 403
    )
    assert _post_from(app, host="http://localhost:5001", origin="http://attacker.example:5001").status_code == 403
    for local in ("http://localhost:3000", "http://127.0.0.1:6274", "http://[::1]:3000"):
        assert _post_from(app, host="http://localhost:5001", origin=local).status_code == 200
    assert _post_from(app, host="http://192.168.1.20:5001", origin=None).status_code == 200


def test_discovery_built_from_the_host_header_is_not_cacheable(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: a Host-derived document was served `Cache-Control: public` for an hour."""
    monkeypatch.setattr(well_known.dify_config, "KNOWLEDGE_AGENT_ACCESS_ENABLED", True)

    def discover() -> tuple[Response, Response]:
        with app.test_request_context("/.well-known/oauth-authorization-server", base_url="http://localhost:5001"):
            return well_known.oauth_protected_resource(), well_known.oauth_authorization_server()

    for api_url, web_url, cacheable in (
        ("", "", False),
        ("https://dify.test", "", False),
        ("", "https://cloud.dify.test", False),
        ("https://dify.test", "https://cloud.dify.test", True),
    ):
        monkeypatch.setattr(well_known.dify_config, "SERVICE_API_URL", api_url)
        monkeypatch.setattr(well_known.dify_config, "CONSOLE_WEB_URL", web_url)
        for response in discover():
            assert response.status_code == 200
            assert response.headers["Cache-Control"] == ("public, max-age=3600" if cacheable else "no-store")
    # Unconfigured deployments still answer for the host that asked.
    monkeypatch.setattr(well_known.dify_config, "SERVICE_API_URL", "")
    monkeypatch.setattr(well_known.dify_config, "CONSOLE_WEB_URL", "")
    resource, server = discover()
    assert json.loads(resource.get_data())["resource"] == "http://localhost:5001/mcp/knowledge"
    assert json.loads(server.get_data())["issuer"] == "http://localhost:5001"


# -- Request body cap --------------------------------------------------------------------------------


class _CountingBody:
    """A request body of ``size`` bytes that counts what is taken from it."""

    def __init__(self, size: int) -> None:
        self.left = size
        self.taken = 0

    def read(self, size: int = -1) -> bytes:
        count = self.left if size is None or size < 0 else min(size, self.left)
        self.left -= count
        self.taken += count
        return b" " * count

    def readline(self, size: int = -1) -> bytes:
        return self.read(size)


def _oversized(
    app: Flask, path: str, view: Callable[[], Response], *, declared: bool, content_type: str = "application/json"
) -> tuple[Response, _CountingBody]:
    body = _CountingBody(3 * module._MAX_BODY)
    environ = EnvironBuilder(
        path,
        method="POST",
        content_type=content_type,
        headers=[("Authorization", "Bearer dfok_x")],
        base_url="https://dify.test",
    ).get_environ()
    environ["wsgi.input"] = body
    if declared:
        environ["CONTENT_LENGTH"] = str(body.left)
    else:
        # Chunked transfer: no declared length; the server marks the stream as terminated.
        environ.pop("CONTENT_LENGTH", None)
        environ["wsgi.input_terminated"] = True
    with app.request_context(environ):
        return view(), body


@pytest.mark.usefixtures("service")
@pytest.mark.parametrize("declared", [True, False], ids=["content-length", "chunked"])
def test_oversized_bodies_are_refused_without_being_loaded(app: Flask, declared: bool) -> None:
    """Regression: the whole body was read into memory and cut to the cap afterwards."""
    views: list[tuple[str, Callable[[], Response], str]] = [
        ("/mcp/knowledge", lambda: module.KnowledgeAgentMcpApi().post(), "application/json"),
        ("/mcp/knowledge/oauth/register", lambda: module.KnowledgeAgentRegisterApi().post(), "application/json"),
        (
            "/mcp/knowledge/oauth/token",
            lambda: module.KnowledgeAgentTokenApi().post(),
            "application/x-www-form-urlencoded",
        ),
        (
            "/mcp/knowledge/oauth/revoke",
            lambda: module.KnowledgeAgentRevokeApi().post(),
            "application/x-www-form-urlencoded",
        ),
    ]
    for path, view, content_type in views:
        response, body = _oversized(app, path, view, declared=declared, content_type=content_type)
        assert response.status_code == 413, path
        # A declared length is refused before anything is read; otherwise reading stops at the cap.
        assert body.taken <= (0 if declared else module._MAX_BODY + 1), path
        assert json.loads(response.get_data())["error"] in {"payload_too_large", "invalid_request"}


def test_a_body_of_exactly_the_cap_is_still_read(app: Flask, service: StubService) -> None:
    padding = " " * (module._MAX_BODY - len('{"jsonrpc":"2.0","id":1,"method":"ping"}'))
    with app.test_request_context(
        "/mcp/knowledge",
        method="POST",
        data='{"jsonrpc":"2.0","id":1,"method":"ping"}' + padding,
        headers={"Content-Type": "application/json", "Authorization": "Bearer dfok_x"},
        base_url="https://dify.test",
    ):
        response = module.KnowledgeAgentMcpApi().post()
    assert response.status_code == 200
    assert service.tokens == ["dfok_x"]


# -- Cost of a request -------------------------------------------------------------------------------


def test_a_tool_call_costs_two_statements_and_two_permission_lookups(
    app: Flask, world: tuple[World, FakeKnowledgeFacade], sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Pins the per-request cost so it cannot creep back up (it was seven statements and more).

    Nothing is cached to get there: the connection, the member, the workspace switch and the
    knowledge base's sharing are all still read on this very request.
    """
    built, facade = world
    created = built.service.create_personal_token(
        account=built.member_account,
        tenant_id=built.tenant,
        body={"name": "CI", "knowledge_base_ids": ["kb-handbook", "kb-finance"]},
    )
    token = created["token"]
    # The first request also resolves the bearer (one lookup, then cached by hash) and stamps last use.
    assert _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"}).status_code == 200

    statements: list[str] = []

    def record(_connection: object, _cursor: object, statement: str, *_rest: object) -> None:
        statements.append(statement)

    engine = sqlite_session_factory.kw["bind"]
    built.spaces.calls.clear()
    event.listen(engine, "before_cursor_execute", record)
    try:
        listed = _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"})
        typical = list(statements)
        typical_lookups = list(built.spaces.calls)
        statements.clear()
        built.spaces.calls.clear()
        # The protocol's own methods and a base outside the connection resolve no knowledge base.
        for method in ("ping", "tools/list"):
            _post(app, {"jsonrpc": "2.0", "id": 1, "method": method}, {"Authorization": f"Bearer {token}"})
        _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-board"})
        cheap_lookups = list(built.spaces.calls)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert listed.status_code == 200
    assert len(facade.calls) == 2
    assert len(typical) == 2, typical
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in typical)
    assert "JOIN knowledge_agent_grants" in typical[0]
    assert typical_lookups == [("readable", ("kb-handbook",)), ("blocked", ("kb-handbook",))]
    assert cheap_lookups == []
    assert len(statements) == 3 * 2, statements

    # Still nothing cached: revocation and unsharing apply to the very next request.
    built.spaces.readable_ids.discard("kb-handbook")
    refused = json.loads(_call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"}).get_data())
    assert refused["result"]["isError"] is True
    built.service.revoke_grant(
        account=built.member_account, tenant_id=built.tenant, role="normal", grant_id=created["grant"]["id"]
    )
    assert _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"}).status_code == 401


# -- What the endpoint refuses before a tool runs ----------------------------------------------------


def _post_raw(app: Flask, data: str, headers: dict[str, str] | None = None) -> Response:
    with app.test_request_context(
        "/mcp/knowledge",
        method="POST",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer dfok_x", **(headers or {})},
        base_url="https://dify.test",
    ):
        return module.KnowledgeAgentMcpApi().post()


@pytest.mark.parametrize(
    ("header", "token"),
    [("Basic dfok_x", None), ("Bearer", None), ("Bearer    ", None), ("dfok_x", None), ("bearer   dfok_x  ", "dfok_x")],
)
def test_only_a_bearer_token_is_authenticated(app: Flask, service: StubService, header: str, token: str | None) -> None:
    response = _post_raw(app, '{"jsonrpc":"2.0","id":1,"method":"ping"}', {"Authorization": header})
    if token is None:
        assert response.status_code == 401
        assert json.loads(response.get_data()) == {
            "error": "unauthorized",
            "error_description": "Sign in to use the knowledge base",
        }
        assert response.headers["WWW-Authenticate"].endswith('scope="knowledge:read"')
        assert response.headers["Cache-Control"] == "no-store"
        assert service.tokens == []
    else:
        assert response.status_code == 200
        assert service.tokens == [token]


def test_a_bearer_refused_because_the_feature_is_off_is_not_asked_to_sign_in_again(
    app: Flask, service: StubService
) -> None:
    service.auth = KnowledgeAgentAuthFailure(404, "agent_access_unavailable")
    response = _post_raw(app, '{"jsonrpc":"2.0","id":1,"method":"ping"}')
    assert response.status_code == 404
    assert json.loads(response.get_data())["error"] == "agent_access_unavailable"
    assert "WWW-Authenticate" not in response.headers


@pytest.mark.parametrize(
    ("body", "code", "message"),
    [
        ('{"jsonrpc": "2.0", "id": 1, "method": ', -32700, "Parse error"),
        ("tools/list", -32700, "Parse error"),
        ("", -32600, "Invalid request"),
        ("null", -32600, "Invalid request"),
        ('"ping"', -32600, "Invalid request"),
        # Batches were removed from the protocol; an array is not a request.
        ('[{"jsonrpc": "2.0", "id": 1, "method": "ping"}]', -32600, "Invalid request"),
    ],
)
def test_a_body_that_is_not_one_json_rpc_message_is_a_400(
    app: Flask, service: StubService, body: str, code: int, message: str
) -> None:
    response = _post_raw(app, body)
    assert response.status_code == 400
    assert json.loads(response.get_data()) == {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": code, "message": message},
    }
    # The caller was authenticated first: an anonymous caller learns nothing about parsing.
    assert service.tokens == ["dfok_x"]


def test_an_unsupported_protocol_version_header_is_refused_except_on_initialize(
    app: Flask, service: StubService
) -> None:
    old = {"MCP-Protocol-Version": "1999-01-01"}
    refused = _post_raw(app, '{"jsonrpc":"2.0","id":"req-9","method":"tools/list"}', old)
    assert refused.status_code == 400
    assert json.loads(refused.get_data()) == {
        "jsonrpc": "2.0",
        "id": "req-9",
        "error": {"code": -32600, "message": "Unsupported MCP-Protocol-Version: 1999-01-01"},
    }
    # Initialize negotiates in its body, so the header is not what decides.
    initialize = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}'
    negotiated = _post_raw(app, initialize, old)
    assert negotiated.status_code == 200
    assert json.loads(negotiated.get_data())["result"]["protocolVersion"] == "2025-06-18"
    for supported in ("2024-11-05", "2025-03-26", "2025-06-18", ""):
        accepted = _post_raw(app, '{"jsonrpc":"2.0","id":1,"method":"ping"}', {"MCP-Protocol-Version": supported})
        assert accepted.status_code == 200
    assert len(service.tokens) == 6


def test_the_endpoint_answers_404_while_agent_knowledge_base_is_off(
    app: Flask, service: StubService, monkeypatch: pytest.MonkeyPatch
) -> None:
    built: list[object] = []
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=False))
    monkeypatch.setattr(module, "get_knowledge_fs_runtime", built.append)
    response = _post_raw(app, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    assert response.status_code == 404
    assert json.loads(response.get_data()) == {
        "error": "not_found",
        "error_description": "Agent Knowledge Base is not enabled",
    }
    assert built == []
    assert service.tokens == ["dfok_x"]


def test_get_and_delete_say_which_method_to_use(app: Flask) -> None:
    with app.test_request_context("/mcp/knowledge", method="GET"):
        for response in (module.KnowledgeAgentMcpApi().get(), module.KnowledgeAgentMcpApi().delete()):
            assert response.status_code == 405
            assert response.headers["Allow"] == "POST"
            assert json.loads(response.get_data()) == {"error": "method_not_allowed", "error_description": "Use POST"}


# -- OAuth endpoints: body formats -------------------------------------------------------------------


def _oauth_post(app: Flask, path: str, view: Callable[[], Response], data: str, content_type: str) -> Response:
    with app.test_request_context(
        f"/mcp/knowledge/oauth/{path}",
        method="POST",
        data=data,
        content_type=content_type,
        base_url="https://dify.test",
    ):
        return view()


def test_the_token_endpoint_also_takes_a_json_object(app: Flask, service: StubService) -> None:
    form = {"grant_type": "authorization_code", "code": "x", "client_id": "y"}
    view = module.KnowledgeAgentTokenApi().post
    for content_type in ("application/json", "application/vnd.api+json"):
        response = _oauth_post(app, "token", view, json.dumps(form), content_type)
        assert json.loads(response.get_data())["error"] == "invalid_grant"
    assert [exchanged for exchanged, _ in service.exchanges] == [form, form]
    # An empty JSON body is an empty form: the service says what is missing.
    _oauth_post(app, "token", view, "", "application/json")
    assert service.exchanges[-1][0] == {}

    for body in ("{not json", "[]", '"grant_type=refresh_token"', "null", "7"):
        refused = _oauth_post(app, "token", view, body, "application/json")
        assert refused.status_code == 400
        assert json.loads(refused.get_data()) == {
            "error": "invalid_request",
            "error_description": "Body must be a JSON object",
        }
        assert refused.headers["Cache-Control"] == "no-store"
    assert len(service.exchanges) == 3


def test_revocation_reports_a_missing_token_and_takes_json_too(
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
) -> None:
    built, _ = world
    token = built.service.create_personal_token(
        account=built.member_account, tenant_id=built.tenant, body={"name": "CI", "knowledge_base_ids": ["kb-handbook"]}
    )["token"]
    view = module.KnowledgeAgentRevokeApi().post

    missing = _oauth_post(app, "revoke", view, "token_type_hint=access_token", "application/x-www-form-urlencoded")
    assert missing.status_code == 400
    assert json.loads(missing.get_data()) == {"error": "invalid_request", "error_description": "token is required"}
    assert _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"}).status_code == 200

    revoked = _oauth_post(app, "revoke", view, json.dumps({"token": token}), "application/json")
    assert revoked.status_code == 200
    assert revoked.get_data() == b""
    assert _call_tool(app, token, "list_documents", {"knowledgeBaseId": "kb-handbook"}).status_code == 401


@pytest.mark.usefixtures("world")
@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        ("redirect_uris=http://localhost/callback", "application/x-www-form-urlencoded"),
        ('{"redirect_uris": ["http://localhost/callback"]', "application/json"),
        ('["http://localhost/callback"]', "application/json"),
        ("", "application/json"),
        ('{"redirect_uris": ["http://localhost/callback"]}', "text/plain"),
    ],
)
def test_registration_takes_a_json_object_and_nothing_else(app: Flask, data: str, content_type: str) -> None:
    response = _oauth_post(app, "register", module.KnowledgeAgentRegisterApi().post, data, content_type)
    assert response.status_code == 400
    assert json.loads(response.get_data()) == {
        "error": "invalid_client_metadata",
        "error_description": "Body must be a JSON object",
    }


def test_registration_is_a_404_while_the_deployment_switch_is_off(
    app: Flask, world: tuple[World, FakeKnowledgeFacade]
) -> None:
    built, _ = world
    built.deployment.on = False
    body = json.dumps({"redirect_uris": ["http://localhost/callback"]})
    view = module.KnowledgeAgentRegisterApi().post
    response = _oauth_post(app, "register", view, body, "application/json")
    assert response.status_code == 404
    assert json.loads(response.get_data()) == {
        "error": "agent_access_unavailable",
        "error_description": "Agent connections are not enabled",
    }
    # Refused before it was counted or stored.
    assert built.redis.values == {}
    built.deployment.on = True
    assert _oauth_post(app, "register", view, body, "application/json").status_code == 201


def test_any_other_access_error_at_registration_is_a_400_with_its_code(
    app: Flask, service: StubService, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse() -> None:
        raise KnowledgeAgentAccessError(403, "agent_access_disabled", "Agent access is turned off for this workspace")

    monkeypatch.setattr(service, "require_enabled", refuse)
    response = _oauth_post(
        app,
        "register",
        module.KnowledgeAgentRegisterApi().post,
        json.dumps({"redirect_uris": ["http://localhost/callback"]}),
        "application/json",
    )
    assert response.status_code == 400
    assert json.loads(response.get_data()) == {
        "error": "agent_access_disabled",
        "error_description": "Agent access is turned off for this workspace",
    }
