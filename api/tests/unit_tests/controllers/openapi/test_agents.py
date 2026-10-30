from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import cast

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants.oauth_bearer import Scope
from controllers.common.agent_access import AgentAccessFilter
from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.openapi import agents
from controllers.openapi._models import AgentDescribeInfo, AgentListRow
from controllers.openapi.agents import AgentDescribeApi
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScopeEarly,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.app.app_config.common.parameters_mapping import AppParametersDict
from extensions.ext_application_services import ApplicationServices
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import AppMode
from services.agent.roster_service import AgentRosterService
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from tests.helpers.unit.controllers.openapi.auth._world import EndpointOwner, canonical
from tests.helpers.unit.model_factories import make_app
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

AGENT_ID = "11111111-1111-4111-8111-111111111111"
UPDATED_AT = datetime(2026, 10, 30, 12, 0, 0)


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
    app = make_app(
        app_id=app_id,
        tenant_id=admitted_bearer.workspace_id,
        name="Support desk",
        description="Answers tickets",
        mode=AppMode.AGENT,
    )
    app.updated_at = UPDATED_AT
    sqlite_session.add_all(
        [
            app,
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
    assert AgentListRow.model_validate(row).model_dump() == {
        "agent_id": AGENT_ID,
        "app_id": app_id,
        "name": "Support desk",
        "description": "Answers tickets",
        "role": "triage",
        "published": False,
        "updated_at": UPDATED_AT.isoformat(),
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


SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222"
REVISION_ID = "33333333-3333-4333-8333-333333333333"
APP_VARIABLES = [{"name": "topic", "type": "text", "required": True}]


class PublishState(StrEnum):
    NEVER = "never"
    CLEAN = "clean"
    EDITED = "edited"


@pytest.fixture(autouse=True)
def _services(monkeypatch: pytest.MonkeyPatch, account_application_services: ApplicationServices) -> None:
    monkeypatch.setattr(agents, "application_services", lambda: account_application_services)


def _persist_agent(world: AdmittedWorld, session: Session, state: PublishState, *, enable_api: bool = True) -> str:
    app_id = str(uuid.uuid4())
    published = state != PublishState.NEVER
    app = make_app(
        app_id=app_id, tenant_id=world.workspace_id, name="Support desk", mode=AppMode.AGENT, enable_api=enable_api
    )
    app.updated_at = UPDATED_AT
    rows: list[object] = [
        app,
        Agent(
            id=AGENT_ID,
            tenant_id=world.workspace_id,
            name="Support desk",
            role="triage",
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            app_id=app_id,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id=SNAPSHOT_ID if published else None,
            active_config_is_published=state == PublishState.CLEAN,
        ),
    ]
    if published:
        rows += [
            AgentConfigSnapshot(
                id=SNAPSHOT_ID,
                tenant_id=world.workspace_id,
                agent_id=AGENT_ID,
                version=1,
                config_snapshot=AgentSoulConfig.model_validate({"app_variables": APP_VARIABLES}),
            ),
            AgentConfigRevision(
                id=REVISION_ID,
                tenant_id=world.workspace_id,
                agent_id=AGENT_ID,
                current_snapshot_id=SNAPSHOT_ID,
                revision=1,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            ),
        ]
    session.add_all(rows)
    session.commit()
    return app_id


def _describe(world: AdmittedWorld, query: str = "", agent_id: str = AGENT_ID) -> TestResponse:
    return world.client.get(
        f"/openapi/v1/workspaces/{world.workspace_id}/agents/{agent_id}{query}", headers=world.headers
    )


def _info(app_id: str, *, published: bool) -> dict[str, object]:
    return AgentDescribeInfo(
        agent_id=AGENT_ID,
        app_id=app_id,
        name="Support desk",
        description="",
        role="triage",
        published=published,
        updated_at=UPDATED_AT.isoformat(),
        service_api_enabled=True,
    ).model_dump()


def _hints(world: AdmittedWorld, op: str) -> list[dict[str, object]]:
    return [{"op": op, "input": {"workspace_id": world.workspace_id, "agent_id": AGENT_ID}}]


@pytest.mark.parametrize(
    ("state", "published"),
    [(PublishState.CLEAN, True), (PublishState.EDITED, False)],
    ids=["clean", "edited-since-publish"],
)
def test_describe_agent_shows_the_inputs_of_its_published_version(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, state: PublishState, published: bool
) -> None:
    app_id = _persist_agent(admitted_bearer, sqlite_session, state)

    response = _describe(admitted_bearer)

    body = response.get_json()
    assert response.status_code == 200
    assert body["info"] == _info(app_id, published=published)
    assert [{key: hint[key] for key in ("op", "input")} for hint in body["hints"]] == _hints(
        admitted_bearer, "run.agent"
    )
    assert [row["text-input"]["variable"] for row in body["parameters"]["user_input_form"]] == ["topic"]
    assert body["input_schema"]["required"] == ["query", "inputs"]
    assert body["input_schema"]["properties"]["inputs"]["required"] == ["topic"]


def test_describe_agent_without_a_published_version_hints_the_draft(
    admitted_bearer: AdmittedWorld, sqlite_session: Session
) -> None:
    app_id = _persist_agent(admitted_bearer, sqlite_session, PublishState.NEVER)

    body = _describe(admitted_bearer).get_json()

    assert body["info"] == _info(app_id, published=False)
    assert (body["parameters"], body["input_schema"]) == (None, None)
    assert [{key: hint[key] for key in ("op", "input")} for hint in body["hints"]] == _hints(
        admitted_bearer, "test.agent"
    )


def test_describe_agent_whose_definition_is_unavailable_is_refused(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN)

    def unavailable(_service: AppDefinitionQueryService, _app_id: str) -> AppParametersDict:
        raise AppDefinitionUnavailableError

    monkeypatch.setattr(AppDefinitionQueryService, "get_public_parameters", unavailable)

    response = _describe(admitted_bearer)

    assert (response.status_code, response.get_json()["code"]) == (400, "app_unavailable")


def test_describe_agent_keeps_only_the_requested_blocks(
    admitted_bearer: AdmittedWorld, sqlite_session: Session
) -> None:
    _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN)

    body = _describe(admitted_bearer, "?fields=input_schema").get_json()

    assert (body["info"], body["parameters"]) == (None, None)
    assert body["input_schema"]["required"] == ["query", "inputs"]


def test_describe_agent_rejects_an_unknown_field(admitted_bearer: AdmittedWorld, sqlite_session: Session) -> None:
    _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN)

    assert _describe(admitted_bearer, "?fields=secrets").status_code == 422


def test_describe_agent_writes_nothing(admitted_bearer: AdmittedWorld, sqlite_session: Session) -> None:
    _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN)
    conversations = select(AgentDebugConversation)

    assert _describe(admitted_bearer).status_code == 200

    assert sqlite_session.scalars(conversations).all() == []


def test_describe_agent_of_another_workspace_is_not_found(
    admitted_bearer: AdmittedWorld, sqlite_session: Session
) -> None:
    _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN)
    sqlite_session.execute(update(Agent).values(tenant_id=str(uuid.uuid4())))
    sqlite_session.commit()

    response = _describe(admitted_bearer)

    assert (response.status_code, response.get_json()["message"]) == (404, "agent not found")


def test_describe_agent_with_its_service_api_off_is_refused(
    admitted_bearer: AdmittedWorld, sqlite_session: Session
) -> None:
    app_id = _persist_agent(admitted_bearer, sqlite_session, PublishState.CLEAN, enable_api=False)

    response = _describe(admitted_bearer)

    body = response.get_json()
    assert (response.status_code, body["code"]) == (403, "service_api_disabled")
    assert body["hints"] == [
        {
            "summary": "Turn the Service API on",
            "op": "set.service_api.agent",
            "input": {"app_id": app_id, "enabled": True},
        }
    ]


def test_describe_agent_declares_its_guards() -> None:
    spec = cast(EndpointOwner, AgentDescribeApi.get).__spec__
    expected = (
        CheckSubject(allowed=(AccountSubject,)),
        CheckWorkspaceMember(),
        CheckScopeEarly(Scope.APPS_READ),
        CheckAppApiEnabled(),
        CheckRBACPermission(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())),
    )

    assert [*map(canonical, spec.requirements)] == [*map(canonical, expected)]
    assert spec.context == "orm"
