"""Console routes of knowledge-agent connections."""

from __future__ import annotations

import inspect
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from flask import Flask

import controllers.console.knowledge_fs.agent_access as module
from libs.exception import RelayedHTTPError
from services.knowledge_agent.access_service import KnowledgeAgentAccessError

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
