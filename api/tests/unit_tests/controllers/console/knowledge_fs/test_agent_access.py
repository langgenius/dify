"""Console routes of knowledge-agent connections."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import TypedDict
from urllib.parse import parse_qs, urlsplit

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

import controllers.console.knowledge_fs.agent_access as module
from enums.account import TenantAccountRole
from libs.exception import RelayedHTTPError
from models.account import Account
from services.knowledge_agent import knowledge_agent_urls
from services.knowledge_agent.access_service import KnowledgeAgentAccessError, KnowledgeAgentPrincipal
from tests.helpers.unit.knowledge_agent import (
    CALLBACK,
    World,
    console_account,
    knowledge_agent_world,
    knowledge_fs_features,
    pkce,
    register,
)

GRANT = {
    "id": "grant-1",
    "kind": "personal",
    "name": "CI",
    "client_name": None,
    "scopes": ["knowledge:read"],
    "knowledge_base_ids": ["kb-1"],
    "created_at": datetime(2026, 11, 1, tzinfo=UTC),
    "expires_at": None,
    "last_used_at": None,
}


class StubService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def list_mine(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(("list_mine", kwargs))
        return {
            "available": True,
            "agent_access_enabled": True,
            "blocked_knowledge_base_ids": [],
            "mcp_url": "https://dify.test/mcp/knowledge",
            "grants": [GRANT],
        }

    def create_personal_token(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(("create_personal_token", kwargs))
        return {"grant": GRANT, "token": "dfok_secret"}

    def revoke_grant(self, **kwargs: object) -> None:
        self.calls.append(("revoke_grant", kwargs))


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> StubService:
    stub = StubService()
    account = console_account("acct", TenantAccountRole.OWNER)
    monkeypatch.setattr(module, "knowledge_agent_access_service", lambda: stub)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (account, "tenant"))
    return stub


def test_lists_your_connections_with_the_mcp_url(app: Flask, service: StubService) -> None:
    with app.test_request_context("/console/api/knowledge-fs/agent-access", base_url="https://dify.test"):
        result = inspect.unwrap(module.KnowledgeAgentMineApi.get)(module.KnowledgeAgentMineApi())
    assert result["mcp_url"] == "https://dify.test/mcp/knowledge"
    assert result["grants"][0]["knowledge_base_ids"] == ["kb-1"]
    assert service.calls[0][1]["tenant_id"] == "tenant"


def test_creates_a_personal_token_shown_once(app: Flask, service: StubService) -> None:
    body = {"name": "CI", "knowledge_base_ids": ["kb-1"], "expires_in_days": 7}
    with app.test_request_context("/console/api/knowledge-fs/agent-access/tokens", method="POST", json=body):
        module.console_ns.payload  # noqa: B018 - flask-restx reads the JSON body lazily
        result, status = inspect.unwrap(module.KnowledgeAgentTokensApi.post)(module.KnowledgeAgentTokensApi())
    assert status == 201
    assert result["token"] == "dfok_secret"
    assert service.calls[0][1]["body"] == body


def test_disconnect_passes_the_workspace_role(app: Flask, service: StubService) -> None:
    with app.test_request_context(method="DELETE"):
        response = inspect.unwrap(module.KnowledgeAgentGrantApi.delete)(module.KnowledgeAgentGrantApi(), "grant-1")
    assert response[1] == 204
    assert service.calls[0][1]["role"] == "owner"


def test_access_errors_keep_their_code_status_and_details(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))

    @module._agent_errors
    def view() -> None:
        raise KnowledgeAgentAccessError(
            422, "knowledge_base_agent_access_blocked", "Agent access is turned off", {"knowledge_base_ids": ["kb-2"]}
        )

    with pytest.raises(RelayedHTTPError) as error:
        view()
    assert error.value.code == 422
    assert error.value.data == {
        "code": "knowledge_base_agent_access_blocked",
        "message": "Agent access is turned off",
        "status": 422,
        "details": {"knowledge_base_ids": ["kb-2"]},
    }


# -- End to end: the real service behind the routes ------------------------------------------------


class SignedIn:
    """Who the Console request is from: the member at first; tests switch to the other account."""

    def __init__(self, world: World) -> None:
        self.world = world
        self.account_id = world.member
        self.role = "normal"

    def as_other(self, role: str) -> None:
        self.account_id, self.role = self.world.admin, role

    def current(self) -> tuple[Account, str]:
        return console_account(self.account_id, TenantAccountRole(self.role)), self.world.tenant


@pytest.fixture
def signed_in(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[SignedIn]:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))
    with knowledge_agent_world(sqlite_session_factory) as world:
        session = SignedIn(world)
        monkeypatch.setattr(module, "knowledge_agent_access_service", lambda: world.service)
        monkeypatch.setattr(module, "current_account_with_tenant", session.current)
        yield session


@contextmanager
def _console_request(app: Flask, method: str, json: object = None) -> Generator[None]:
    with app.test_request_context(
        "/console/api/knowledge-fs/agent-access", method=method, json=json, base_url="https://dify.test"
    ):
        if json is not None:
            module.console_ns.payload  # noqa: B018 - flask-restx reads the JSON body lazily
        yield


# The route bodies with their error translation, without the login decorators.
_create_token = module._agent_errors(inspect.unwrap(module.KnowledgeAgentTokensApi.post))
_list_mine = module._agent_errors(inspect.unwrap(module.KnowledgeAgentMineApi.get))
_update_grant = module._agent_errors(inspect.unwrap(module.KnowledgeAgentGrantApi.patch))
_disconnect = module._agent_errors(inspect.unwrap(module.KnowledgeAgentGrantApi.delete))


def test_a_member_creates_lists_narrows_and_disconnects_a_personal_token(app: Flask, signed_in: SignedIn) -> None:
    service = signed_in.world.service
    with _console_request(app, "POST", {"name": "Laptop", "knowledge_base_ids": ["kb-handbook", "kb-finance"]}):
        created, status = _create_token(module.KnowledgeAgentTokensApi())
    assert status == 201
    token = created["token"]
    grant_id = created["grant"]["id"]
    assert created["grant"]["token_hint"] == token[-4:]
    assert created["grant"]["kind"] == "personal"
    principal = service.authenticate(token)
    assert isinstance(principal, KnowledgeAgentPrincipal)
    assert sorted(principal.control_space_ids) == ["kb-finance", "kb-handbook"]

    # Blocked for agents but not shared with this member: it must not show up in their view.
    signed_in.world.spaces.blocked_ids.add("kb-secret")
    with _console_request(app, "GET"):
        mine = _list_mine(module.KnowledgeAgentMineApi())
    assert mine["mcp_url"] == "https://dify.test/mcp/knowledge"
    assert mine["blocked_knowledge_base_ids"] == ["kb-board"]
    assert [grant["id"] for grant in mine["grants"]] == [grant_id]
    assert "token" not in mine["grants"][0]

    with _console_request(app, "PATCH", {"knowledge_base_ids": ["kb-finance"]}):
        updated = _update_grant(module.KnowledgeAgentGrantApi(), grant_id)
    assert updated["knowledge_base_ids"] == ["kb-finance"]

    with _console_request(app, "DELETE"):
        _, status = _disconnect(module.KnowledgeAgentGrantApi(), grant_id)
    assert status == 204
    assert not isinstance(service.authenticate(token), KnowledgeAgentPrincipal)


def test_other_members_are_refused_and_workspace_admins_may_only_disconnect(app: Flask, signed_in: SignedIn) -> None:
    service = signed_in.world.service
    with _console_request(app, "POST", {"name": "Laptop", "knowledge_base_ids": ["kb-handbook"]}):
        created, _ = _create_token(module.KnowledgeAgentTokensApi())
    grant_id = created["grant"]["id"]
    grant_api = module.KnowledgeAgentGrantApi()

    def refused_update(knowledge_base_ids: list[str]) -> dict[str, object]:
        with _console_request(app, "PATCH", {"knowledge_base_ids": knowledge_base_ids}):
            with pytest.raises(RelayedHTTPError) as error:
                _update_grant(grant_api, grant_id)
        return _relayed(error.value)

    def refused_disconnect(target: str) -> dict[str, object]:
        with _console_request(app, "DELETE"):
            with pytest.raises(RelayedHTTPError) as error:
                _disconnect(grant_api, target)
        return _relayed(error.value)

    # A blocked base is refused with its code and the offending ids.
    blocked = refused_update(["kb-board"])
    assert blocked["status"] == 422
    assert blocked["code"] == "knowledge_base_agent_access_blocked"
    assert blocked["details"] == {"knowledge_base_ids": ["kb-board"]}

    signed_in.as_other("normal")
    for refused in (refused_update(["kb-finance"]), refused_disconnect(grant_id)):
        assert (refused["status"], refused["code"]) == (403, "permission_denied")
    unknown = refused_disconnect("no-such-grant")
    assert (unknown["status"], unknown["code"]) == (404, "agent_grant_not_found")
    assert isinstance(service.authenticate(created["token"]), KnowledgeAgentPrincipal)

    # A workspace admin still cannot edit someone else's connection, but can end it.
    signed_in.as_other("admin")
    refused = refused_update(["kb-finance"])
    assert (refused["status"], refused["code"]) == (403, "permission_denied")
    with _console_request(app, "DELETE"):
        _, status = _disconnect(grant_api, grant_id)
    assert status == 204
    assert not isinstance(service.authenticate(created["token"]), KnowledgeAgentPrincipal)


def _relayed(error: RelayedHTTPError) -> dict[str, object]:
    data = error.data
    assert data is not None
    return {**data, "status": error.code}


def test_the_consent_page_names_only_blocked_bases_the_member_can_read(app: Flask, signed_in: SignedIn) -> None:
    """Regression: the authorize route described the request without saying which member asked."""
    world = signed_in.world
    world.spaces.blocked_ids.add("kb-secret")
    client_id = register(world)
    _, challenge = pkce()
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    describe = module._agent_errors(inspect.unwrap(module.KnowledgeAgentAuthorizeApi.get))
    with app.test_request_context(
        "/console/api/knowledge-fs/agent-access/authorize", query_string=query, base_url="https://dify.test"
    ):
        described = describe(module.KnowledgeAgentAuthorizeApi())
    assert described["blocked_knowledge_base_ids"] == ["kb-board"]
    assert described["client"]["name"] == "Claude Code"
    assert (world.tenant, world.member) in world.spaces.checks


# -- The workspace switch, the consent decision, and the feature flag --------------------------------


class WorkspaceView(TypedDict):
    agent_access_enabled: bool
    grants: list[dict[str, object]]


_workspace = module._agent_errors(inspect.unwrap(module.KnowledgeAgentWorkspaceApi.get))
_set_workspace = module._agent_errors(inspect.unwrap(module.KnowledgeAgentWorkspaceApi.patch))
_describe = module._agent_errors(inspect.unwrap(module.KnowledgeAgentAuthorizeApi.get))
_decide = module._agent_errors(inspect.unwrap(module.KnowledgeAgentAuthorizeApi.post))


def _refused(call: Callable[[], object]) -> dict[str, object]:
    with pytest.raises(RelayedHTTPError) as error:
        call()
    return _relayed(error.value)


def test_a_workspace_admin_sees_every_connection_and_switches_agents_off_and_on(
    app: Flask, signed_in: SignedIn
) -> None:
    world = signed_in.world
    workspace_api = module.KnowledgeAgentWorkspaceApi()
    with _console_request(app, "POST", {"name": "Laptop", "knowledge_base_ids": ["kb-handbook"]}):
        created, _ = _create_token(module.KnowledgeAgentTokensApi())

    def set_enabled(enabled: bool) -> WorkspaceView:
        with _console_request(app, "PATCH", {"enabled": enabled}):
            changed = _set_workspace(workspace_api)
            return {"agent_access_enabled": changed["agent_access_enabled"], "grants": changed["grants"]}

    # A member may neither look nor switch.
    with _console_request(app, "GET"):
        looked = _refused(lambda: _workspace(workspace_api))
    assert (looked["status"], looked["code"]) == (403, "permission_denied")
    switched = _refused(lambda: set_enabled(False))
    assert (switched["status"], switched["code"]) == (403, "permission_denied")
    assert isinstance(world.service.authenticate(created["token"]), KnowledgeAgentPrincipal)

    signed_in.as_other("owner")
    with _console_request(app, "GET"):
        settings = _workspace(workspace_api)
    assert settings["agent_access_enabled"] is True
    assert [(grant["id"], grant["name"], grant["account"]) for grant in settings["grants"]] == [
        (created["grant"]["id"], "Laptop", {"id": world.member, "name": "Mia", "email": "mia@example.com"})
    ]
    assert "token" not in settings["grants"][0]

    off = set_enabled(False)
    assert off["agent_access_enabled"] is False
    assert [grant["id"] for grant in off["grants"]] == [created["grant"]["id"]]
    assert not isinstance(world.service.authenticate(created["token"]), KnowledgeAgentPrincipal)
    with _console_request(app, "POST", {"name": "Phone", "knowledge_base_ids": ["kb-handbook"]}):
        disabled = _refused(lambda: _create_token(module.KnowledgeAgentTokensApi()))
    assert (disabled["status"], disabled["code"]) == (403, "agent_access_disabled")

    assert set_enabled(True)["agent_access_enabled"] is True
    assert isinstance(world.service.authenticate(created["token"]), KnowledgeAgentPrincipal)


def test_an_account_without_a_workspace_role_is_not_a_workspace_admin(
    app: Flask, signed_in: SignedIn, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = console_account(signed_in.world.admin, None)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (account, signed_in.world.tenant))
    with _console_request(app, "GET"):
        refused = _refused(lambda: _workspace(module.KnowledgeAgentWorkspaceApi()))
    assert (refused["status"], refused["code"]) == (403, "permission_denied")


def _authorization_request(world: World) -> dict[str, str]:
    _, challenge = pkce()
    return {
        "response_type": "code",
        "client_id": register(world),
        "redirect_uri": CALLBACK,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "state-1",
    }


def test_approving_sends_the_browser_back_with_a_code_for_the_chosen_bases(app: Flask, signed_in: SignedIn) -> None:
    world = signed_in.world
    verifier, challenge = pkce()
    request = {**_authorization_request(world), "code_challenge": challenge}
    with _console_request(app, "POST", {**request, "approve": True, "knowledge_base_ids": ["kb-finance"]}):
        decided = _decide(module.KnowledgeAgentAuthorizeApi())
    assert set(decided) == {"redirect_to"}
    redirect = urlsplit(decided["redirect_to"])
    query = parse_qs(redirect.query)
    assert f"{redirect.scheme}://{redirect.netloc}{redirect.path}" == CALLBACK
    assert query["state"] == ["state-1"]
    # The issuer is the public API host of the request, which is what the client verifies.
    assert query["iss"] == ["https://dify.test"]
    assert "error" not in query

    tokens = world.service.exchange_token(
        {
            "grant_type": "authorization_code",
            "code": query["code"][0],
            "client_id": request["client_id"],
            "code_verifier": verifier,
        },
        knowledge_agent_urls("https://dify.test/"),
    )
    principal = world.service.authenticate(tokens["access_token"])
    assert isinstance(principal, KnowledgeAgentPrincipal)
    assert (principal.account_id, principal.control_space_ids) == (world.member, ("kb-finance",))


def test_denying_sends_the_browser_back_without_a_code(app: Flask, signed_in: SignedIn) -> None:
    world = signed_in.world
    with _console_request(app, "POST", {**_authorization_request(world), "approve": False}):
        decided = _decide(module.KnowledgeAgentAuthorizeApi())
    query = parse_qs(urlsplit(decided["redirect_to"]).query)
    assert query["error"] == ["access_denied"]
    assert query["state"] == ["state-1"]
    assert "code" not in query
    assert not [key for key in world.redis.values if key.startswith("knowledge_agent:code")]


def test_a_decision_the_service_refuses_keeps_its_code_and_details(app: Flask, signed_in: SignedIn) -> None:
    world = signed_in.world
    request = _authorization_request(world)
    authorize_api = module.KnowledgeAgentAuthorizeApi()

    def decide(**changes: object) -> dict[str, object]:
        body = {**request, "approve": True, "knowledge_base_ids": ["kb-handbook"], **changes}
        with _console_request(app, "POST", body):
            return _refused(lambda: _decide(authorize_api))

    blocked = decide(knowledge_base_ids=["kb-handbook", "kb-board"])
    assert (blocked["status"], blocked["code"]) == (422, "knowledge_base_agent_access_blocked")
    assert blocked["details"] == {"knowledge_base_ids": ["kb-board"]}
    nothing = decide(knowledge_base_ids=[])
    assert (nothing["status"], nothing["code"]) == (422, "invalid_knowledge_bases")
    foreign = decide(redirect_uri="https://evil.example/cb")
    assert (foreign["status"], foreign["code"]) == (422, "invalid_redirect_uri")
    assert "details" not in foreign
    assert not [key for key in world.redis.values if key.startswith("knowledge_agent:code")]

    with app.test_request_context(
        "/console/api/knowledge-fs/agent-access/authorize",
        query_string={**request, "response_type": "token"},
        base_url="https://dify.test",
    ):
        described = _refused(lambda: _describe(authorize_api))
    assert (described["status"], described["code"]) == (422, "unsupported_response_type")


@pytest.mark.parametrize(
    ("resource", "method", "path"),
    [
        (module.KnowledgeAgentMineApi, "get", ()),
        (module.KnowledgeAgentTokensApi, "post", ()),
        (module.KnowledgeAgentGrantApi, "patch", ("grant-1",)),
        (module.KnowledgeAgentGrantApi, "delete", ("grant-1",)),
        (module.KnowledgeAgentWorkspaceApi, "get", ()),
        (module.KnowledgeAgentWorkspaceApi, "patch", ()),
        (module.KnowledgeAgentAuthorizeApi, "get", ()),
        (module.KnowledgeAgentAuthorizeApi, "post", ()),
    ],
)
def test_every_route_is_a_404_while_agent_knowledge_base_is_off(
    app: Flask,
    service: StubService,
    monkeypatch: pytest.MonkeyPatch,
    resource: type,
    method: str,
    path: tuple[str, ...],
) -> None:
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=False))
    view = module._agent_errors(inspect.unwrap(vars(resource)[method]))
    with _console_request(app, method.upper(), {"enabled": False}):
        with pytest.raises(NotFound):
            view(resource(), *path)
    assert service.calls == []
