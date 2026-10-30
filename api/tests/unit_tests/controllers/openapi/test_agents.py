from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from controllers.common.agent_access import AgentAccessFilter
from controllers.openapi import agents
from controllers.openapi._models import AgentListRow
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import AppMode
from services.agent.roster_service import AgentRosterService
from tests.helpers.unit.model_factories import make_app
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

AGENT_ID = "11111111-1111-4111-8111-111111111111"


@dataclass
class _RosterSpy:
    """Stands in for the roster read; keeps what the route asked for."""

    calls: list[dict[str, object]] = field(default_factory=list)
    total: int = 0


@pytest.fixture
def roster_spy(monkeypatch: pytest.MonkeyPatch) -> _RosterSpy:
    spy = _RosterSpy()

    def list_agents(_service: AgentRosterService, **kwargs: object) -> tuple[list[object], int]:
        spy.calls.append(kwargs)
        return [], spy.total

    monkeypatch.setattr(AgentRosterService, "list_openapi_roster_agents", list_agents)
    return spy


def _get(world: AdmittedWorld, query: str = "") -> TestResponse:
    return world.client.get(f"/openapi/v1/workspaces/{world.workspace_id}/agents{query}", headers=world.headers)


@pytest.mark.parametrize(
    ("rbac_enabled", "visible", "expected"),
    [(False, {"agent-1"}, None), (True, {"agent-1"}, {"agent-1"}), (True, None, None), (True, set(), set())],
    ids=["rbac-off", "rbac-on-restricted", "rbac-on-unrestricted", "rbac-on-nothing"],
)
def test_get_agent_filters_by_rbac(
    admitted_bearer: AdmittedWorld,
    roster_spy: _RosterSpy,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    rbac_enabled: bool,
    visible: set[str] | None,
    expected: set[str] | None,
) -> None:
    resolved: list[tuple[str, str]] = []

    def resolve(tenant_id: str, account_id: str) -> AgentAccessFilter:
        resolved.append((tenant_id, account_id))
        return AgentAccessFilter(accessible_agent_ids=visible)

    config_overrides(RBAC_ENABLED=rbac_enabled)
    monkeypatch.setattr(agents, "resolve_agent_access_filter", resolve)

    response = _get(admitted_bearer)

    assert response.status_code == 200
    [call] = roster_spy.calls
    assert call["accessible_agent_ids"] == expected
    assert call["tenant_id"] == admitted_bearer.workspace_id
    assert len(resolved) == int(rbac_enabled)


def test_get_agent_passes_the_query_to_the_roster(admitted_bearer: AdmittedWorld, roster_spy: _RosterSpy) -> None:
    _get(admitted_bearer, "?name=support&published=false&page=2&limit=5")

    [call] = roster_spy.calls
    assert (call["name"], call["published"], call["page"], call["limit"]) == ("support", False, 2, 5)


def test_get_agent_rejects_an_unknown_query_field(admitted_bearer: AdmittedWorld, roster_spy: _RosterSpy) -> None:
    assert _get(admitted_bearer, "?status=normal").status_code == 422
    assert roster_spy.calls == []


def test_get_agent_returns_the_rows_of_the_workspace(admitted_bearer: AdmittedWorld, sqlite_session: Session) -> None:
    app_id = str(uuid.uuid4())
    sqlite_session.add_all(
        [
            make_app(
                app_id=app_id,
                tenant_id=admitted_bearer.workspace_id,
                name="Support desk",
                description="Answers tickets",
                mode=AppMode.AGENT,
            ),
            Agent(
                id=AGENT_ID,
                tenant_id=admitted_bearer.workspace_id,
                name="Support desk",
                role="triage",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id=app_id,
                status=AgentStatus.ACTIVE,
            ),
        ]
    )
    sqlite_session.commit()

    body = _get(admitted_bearer, "?name=support").get_json()

    [row] = body["data"]
    assert AgentListRow.model_validate(row).model_dump(exclude={"updated_at"}) == {
        "agent_id": AGENT_ID,
        "app_id": app_id,
        "name": "Support desk",
        "description": "Answers tickets",
        "role": "triage",
        "published": False,
    }
    assert (body["total"], body["has_more"], body["hints"]) == (1, False, [])


def test_get_agent_hints_the_next_page_when_more_remain(admitted_bearer: AdmittedWorld, roster_spy: _RosterSpy) -> None:
    roster_spy.total = 3

    body = _get(admitted_bearer, "?name=support&page=1&limit=2").get_json()

    assert body["has_more"] is True
    assert body["hints"] == [
        {
            "summary": "Next page",
            "op": "get.agent",
            "input": {"workspace_id": admitted_bearer.workspace_id, "name": "support", "page": 2, "limit": 2},
            "form": None,
        }
    ]
