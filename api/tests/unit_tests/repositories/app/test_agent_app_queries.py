"""Agent App queries share tenant, lifecycle, and backing ownership constraints."""

from typing import Literal

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode
from repositories.app.agent_app_queries import get_app_backing_agent, get_roster_agent_app


def _add_app_and_agent(session: Session, *, source: AgentSource = AgentSource.AGENT_APP) -> tuple[App, Agent]:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Agent App",
        mode=AppMode.AGENT,
        enable_site=False,
        enable_api=False,
    )
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Agent",
        app_id=app.id,
        scope=AgentScope.ROSTER,
        source=source,
        status=AgentStatus.ACTIVE,
    )
    session.add_all([app, agent])
    session.flush()
    return app, agent


@pytest.mark.parametrize("source", [AgentSource.AGENT_APP, AgentSource.IMPORTED])
def test_queries_return_active_app_backed_roster_agent_in_own_tenant(
    sqlite_session: Session, source: AgentSource
) -> None:
    app, agent = _add_app_and_agent(sqlite_session, source=source)

    assert get_roster_agent_app(sqlite_session, tenant_id="tenant-1", agent_id=agent.id) is app
    assert get_app_backing_agent(sqlite_session, tenant_id="tenant-1", app_id=app.id) is agent
    assert get_roster_agent_app(sqlite_session, tenant_id="other-tenant", agent_id=agent.id) is None
    assert get_app_backing_agent(sqlite_session, tenant_id="other-tenant", app_id=app.id) is None


@pytest.mark.parametrize("case", ["wrong_app_tenant", "wrong_mode", "missing_app", "missing_agent_app"])
def test_roster_agent_app_requires_a_normal_owned_agent_app(
    sqlite_session: Session, case: Literal["wrong_app_tenant", "wrong_mode", "missing_app", "missing_agent_app"]
) -> None:
    app, agent = _add_app_and_agent(sqlite_session)
    if case == "wrong_app_tenant":
        app.tenant_id = "other-tenant"
    elif case == "wrong_mode":
        app.mode = AppMode.CHAT
    elif case == "missing_app":
        sqlite_session.delete(app)
    elif case == "missing_agent_app":
        agent.app_id = None
    sqlite_session.flush()

    assert get_roster_agent_app(sqlite_session, tenant_id="tenant-1", agent_id=agent.id) is None


def test_roster_agent_app_rejects_historical_non_normal_app(sqlite_session: Session) -> None:
    app, agent = _add_app_and_agent(sqlite_session)
    sqlite_session.execute(text("UPDATE apps SET status = 'archived' WHERE id = :app_id"), {"app_id": app.id})

    assert get_roster_agent_app(sqlite_session, tenant_id="tenant-1", agent_id=agent.id) is None


@pytest.mark.parametrize("case", ["archived", "workflow_only", "roster_source"])
def test_queries_reject_non_active_or_non_app_backed_agents(
    sqlite_session: Session, case: Literal["archived", "workflow_only", "roster_source"]
) -> None:
    app, agent = _add_app_and_agent(sqlite_session)
    if case == "archived":
        agent.status = AgentStatus.ARCHIVED
    elif case == "workflow_only":
        agent.scope = AgentScope.WORKFLOW_ONLY
    elif case == "roster_source":
        agent.source = AgentSource.ROSTER
    sqlite_session.flush()

    assert get_roster_agent_app(sqlite_session, tenant_id="tenant-1", agent_id=agent.id) is None
    assert get_app_backing_agent(sqlite_session, tenant_id="tenant-1", app_id=app.id) is None
