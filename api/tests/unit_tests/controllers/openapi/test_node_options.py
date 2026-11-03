from collections.abc import Callable

import pytest
from flask.testing import FlaskClient
from sqlalchemy import update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from controllers.common.agent_access import AgentAccessFilter
from controllers.openapi import node_options as node_options_controller
from core.tools.entities.api_entities import ToolProviderApiEntity
from models import Account
from services.agent.roster_service import AgentRosterService
from services.tools.tool_sources import ToolSource
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld


def _get(world: AdmittedWorld, query: str) -> TestResponse:
    client: FlaskClient = world.client
    return client.get(f"/openapi/v1/workspaces/{world.workspace_id}/node-options?{query}", headers=world.headers)


@pytest.mark.usefixtures("time_tool")
def test_a_tool_search_returns_the_time_tool_with_its_seed(admitted_bearer: AdmittedWorld) -> None:
    response = _get(admitted_bearer, "app_mode=workflow&kind=tool&keyword=time")

    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert (body["page"], body["total"], body["has_more"]) == (1, 1, False)
    [row] = body["data"]
    assert (row["kind"], row["type"], row["version"], row["label"]) == ("tool", "tool", "1", "Current Time")
    assert row["seed"] == {
        "type": "tool",
        "title": "Current Time",
        "provider_type": "builtin",
        "provider_id": "time",
        "provider_name": "time",
        "tool_name": "current_time",
        "tool_label": "Current Time",
        "tool_node_version": "2",
    }


@pytest.mark.usefixtures("time_tool")
def test_tool_labels_follow_the_accounts_language(admitted_bearer: AdmittedWorld, sqlite_session: Session) -> None:
    sqlite_session.execute(update(Account).values(interface_language="zh-Hans"))
    sqlite_session.commit()

    response = _get(admitted_bearer, "app_mode=workflow&kind=tool&keyword=当前")

    assert [row["label"] for row in response.get_json()["data"]] == ["获取当前时间"]


def test_blocks_are_paged(admitted_bearer: AdmittedWorld) -> None:
    first = _get(admitted_bearer, "app_mode=advanced-chat&kind=block&limit=2").get_json()
    second = _get(admitted_bearer, "app_mode=advanced-chat&kind=block&limit=2&page=2").get_json()

    assert (len(first["data"]), first["has_more"]) == (2, True)
    assert first["total"] == second["total"]
    assert {row["type"] for row in first["data"]}.isdisjoint({row["type"] for row in second["data"]})
    assert any(hint["summary"] == "Next page" for hint in first["hints"])


@pytest.mark.parametrize("query", ["app_mode=chat", "app_mode=agent-chat", "app_mode=nonsense", "kind=tool", ""])
def test_a_mode_without_a_graph_is_refused(admitted_bearer: AdmittedWorld, query: str) -> None:
    response = _get(admitted_bearer, query)

    assert response.status_code == 422


def test_agents_are_limited_to_the_ones_the_account_may_see_under_rbac(
    admitted_bearer: AdmittedWorld,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    asked: list[str] = []

    def account_agent_access(tenant_id: str, _account_id: str) -> AgentAccessFilter:
        asked.append(tenant_id)
        return AgentAccessFilter(accessible_agent_ids={"agent-2", "agent-1"})

    monkeypatch.setattr(node_options_controller, "account_agent_access", account_agent_access)
    seen: list[object] = []

    def list_invite_options(_self: AgentRosterService, **kwargs: object) -> dict[str, object]:
        seen.append(kwargs["accessible_agent_ids"])
        return {"data": [], "page": 1, "limit": 100, "total": 0, "has_more": False}

    monkeypatch.setattr(AgentRosterService, "list_invite_options", list_invite_options)

    response = _get(admitted_bearer, "app_mode=workflow&kind=agent")

    assert response.status_code == 200, response.get_json()
    assert seen == [["agent-1", "agent-2"]]
    assert asked == [admitted_bearer.workspace_id]


def test_without_rbac_every_agent_is_listed(admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[object] = []

    def list_invite_options(_self: AgentRosterService, **kwargs: object) -> dict[str, object]:
        seen.append(kwargs["accessible_agent_ids"])
        data = [{"id": "agent-1", "name": "Writer", "description": ""}]
        return {"data": data, "page": 1, "limit": 100, "total": 1, "has_more": False}

    monkeypatch.setattr(AgentRosterService, "list_invite_options", list_invite_options)

    response = _get(admitted_bearer, "app_mode=workflow&kind=agent")

    assert seen == [None]
    [row] = response.get_json()["data"]
    assert (row["kind"], row["label"], row["description"]) == ("agent", "Writer", None)


@pytest.mark.parametrize(
    ("kind", "asks"), [("&kind=block", False), ("&kind=tool", False), ("&kind=agent", True), ("", True)]
)
def test_agent_access_is_read_only_when_agents_can_be_listed(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch, kind: str, asks: bool
) -> None:
    asked: list[str] = []

    def account_agent_access(tenant_id: str, _account_id: str) -> AgentAccessFilter:
        asked.append(tenant_id)
        return AgentAccessFilter.unrestricted()

    def list_invite_options(_self: AgentRosterService, **_kwargs: object) -> dict[str, object]:
        return {"data": [], "page": 1, "limit": 100, "total": 0, "has_more": False}

    def no_tools(_self: ToolSource, **_kwargs: str) -> list[ToolProviderApiEntity]:
        return []

    monkeypatch.setattr(node_options_controller, "account_agent_access", account_agent_access)
    monkeypatch.setattr(AgentRosterService, "list_invite_options", list_invite_options)
    monkeypatch.setattr(ToolSource, "list_providers", no_tools)

    response = _get(admitted_bearer, f"app_mode=workflow{kind}")

    assert response.status_code == 200, response.get_json()
    assert asked == ([admitted_bearer.workspace_id] if asks else [])
