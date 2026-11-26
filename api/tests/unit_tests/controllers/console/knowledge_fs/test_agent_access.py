"""Console routes of knowledge-agent connections."""

from __future__ import annotations

import inspect
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

import controllers.console.knowledge_fs.agent_access as module
from libs.exception import RelayedHTTPError
from services.knowledge_agent.access_service import KnowledgeAgentAccessError, KnowledgeAgentPrincipal
from tests.helpers.unit.knowledge_agent import World, knowledge_agent_world

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
    account = SimpleNamespace(id="acct", current_role=SimpleNamespace(value="owner"))
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
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: SimpleNamespace(enabled=True))

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

    def current(self) -> tuple[SimpleNamespace, str]:
        account = SimpleNamespace(id=self.account_id, current_role=SimpleNamespace(value=self.role))
        return account, self.world.tenant


@pytest.fixture
def signed_in(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[SignedIn]:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)
    monkeypatch.setattr(module, "get_knowledge_fs_features", lambda: SimpleNamespace(enabled=True))
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
