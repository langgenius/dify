"""Agent detail uses real HTTP, SQLite and the shared response contract."""

import json
from http import HTTPStatus
from uuid import uuid4

from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from controllers.console.agent.roster import _serialize_agent_app_detail
from models import Account, Tenant
from models.agent import Agent, AgentDebugConversation, AgentScope, AgentSource, AgentStatus
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, Site
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


def _legacy_detail(
    app: Flask, sessions: sessionmaker[Session], harness: Harness, agent_id: str, app_id: str
) -> dict[str, object]:
    with app.test_request_context(f"/console/api/agent/{agent_id}"), sessions() as session:
        model = session.get(App, app_id)
        account = session.get(Account, harness.account_id)
        tenant = session.get(Tenant, harness.tenant_id)
        assert model is not None
        assert account is not None
        assert tenant is not None
        account.set_current_tenant_with_session(tenant, session=session)
        result = _serialize_agent_app_detail(session, model, current_user=account, agent_id=agent_id)
        session.commit()
        return result


def test_get_matches_legacy_response_and_reuses_build_conversation(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    expected = _legacy_detail(harness.client.application, harness.sessions, harness, agent_id, app_id)
    response = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == expected
    assert response.get_json()["id"] == agent_id
    assert response.get_json()["app_id"] == app_id
    assert response.get_json()["access_ready"] is True
    with harness.sessions() as session:
        assert (
            len(
                session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent_id)).all()
            )
            == 1
        )


def test_get_with_config_and_site_matches_legacy_response(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        config = AppModelConfig(app_id=app_id, opening_statement="Hello", suggested_questions='["What next?"]')
        site = Site(
            app_id=app_id,
            title="Agent Site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
        )
        session.add_all([config, site])
        session.flush()
        app.app_model_config_id = config.id
    expected = _legacy_detail(harness.client.application, harness.sessions, harness, agent_id, app_id)
    response = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == expected
    assert response.get_json()["model_config"]["opening_statement"] == "Hello"
    assert response.get_json()["site"]["title"] == "Agent Site"


def test_legacy_agent_mode_masks_tool_secrets_and_retains_mode_conversion(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        config = AppModelConfig(
            app_id=app_id,
            agent_mode=json.dumps(
                {
                    "enabled": True,
                    "strategy": "function_call",
                    "tools": [
                        {
                            "provider_type": "api",
                            "provider_id": str(uuid4()),
                            "tool_name": "example",
                            "tool_parameters": {"secret": "cipher"},
                        }
                    ],
                }
            ),
        )
        session.add(config)
        session.flush()
        app.app_model_config_id = config.id
    response = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    assert "cipher" not in response.get_data(as_text=True)
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert app.mode == AppMode.AGENT_CHAT


def test_update_persists_app_and_agent_identity_and_preserves_omitted_role(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.role = "Before"
    response = harness.client.put(
        f"/console/api/agent/{agent_id}",
        headers=harness.headers,
        json={"name": "Renamed", "description": "Example", "icon_type": "emoji", "icon": "R"},
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["id"] == agent_id
    assert response.get_json()["name"] == "Renamed"
    assert response.get_json()["role"] == "Before"
    with harness.sessions() as session:
        app = session.get(App, app_id)
        agent = session.get(Agent, agent_id)
        assert app is not None
        assert agent is not None
        assert app.name == agent.name == "Renamed"
        assert app.description == agent.description == "Example"
        assert agent.role == "Before"
    cleared = harness.client.put(
        f"/console/api/agent/{agent_id}", headers=harness.headers, json={"name": "Renamed", "role": ""}
    )
    assert cleared.status_code == HTTPStatus.OK
    assert cleared.get_json()["role"] == ""


def test_update_conflicting_agent_name_returns_conflict_without_changes(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.name = "First"
    other_id, other_app_id = harness.create_agent()
    response = harness.client.put(f"/console/api/agent/{agent_id}", headers=harness.headers, json={"name": "Agent"})
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "agent_name_conflict_error"
    with harness.sessions() as session:
        agent = session.get(Agent, agent_id)
        app = session.get(App, app_id)
        other = session.get(Agent, other_id)
        assert agent is not None
        assert app is not None
        assert other is not None
        assert agent.name == "First"
        assert app.name == "Agent App"
        assert other.app_id == other_app_id
        assert other.name == "Agent"


def test_detail_and_update_reject_foreign_agents(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(tenant_id=str(uuid4()))
    assert (
        harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers).status_code
        == HTTPStatus.NOT_FOUND
    )
    assert (
        harness.client.put(
            f"/console/api/agent/{agent_id}", headers=harness.headers, json={"name": "Foreign"}
        ).status_code
        == HTTPStatus.NOT_FOUND
    )
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert app.name == "Agent App"


def test_workflow_only_detail_materializes_one_hidden_app(harness: Harness) -> None:
    with harness.sessions.begin() as session:
        workflow = App(
            tenant_id=harness.tenant_id,
            name="Workflow",
            mode=AppMode.WORKFLOW,
            enable_api=True,
            enable_site=True,
            created_by=harness.account_id,
            maintainer=harness.account_id,
        )
        session.add(workflow)
        session.flush()
        agent = Agent(
            tenant_id=harness.tenant_id,
            name="Inline",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=workflow.id,
            workflow_id=str(uuid4()),
            workflow_node_id="node",
            status=AgentStatus.ACTIVE,
            created_by=harness.account_id,
        )
        session.add(agent)
        session.flush()
        agent_id, workflow_id = agent.id, workflow.id
    first = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    second = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    assert first.status_code == second.status_code == HTTPStatus.OK
    assert first.get_json() == second.get_json()
    assert first.get_json()["app_id"] == workflow_id
    assert first.get_json()["backing_app_id"] != workflow_id
    assert first.get_json()["hidden_app_backed"] is True
    update = harness.client.put(f"/console/api/agent/{agent_id}", headers=harness.headers, json={"name": "Changed"})
    assert update.status_code == HTTPStatus.NOT_FOUND
    with harness.sessions() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        assert agent.backing_app_id == first.get_json()["backing_app_id"]
        assert session.get(App, agent.backing_app_id) is not None


def test_detail_session_is_closed_before_permissions_query(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    detail_sessions: set[Session] = set()
    observed: list[bool] = []

    def observe_query(state: ORMExecuteState) -> None:
        statement = str(state.statement).lower()
        if "from agents" in statement:
            detail_sessions.add(state.session)
        elif "from tenant_account_joins" in statement and detail_sessions:
            observed.append(all(not session.in_transaction() for session in detail_sessions))

    event.listen(Session, "do_orm_execute", observe_query)
    try:
        response = harness.client.get(f"/console/api/agent/{agent_id}", headers=harness.headers)
    finally:
        event.remove(Session, "do_orm_execute", observe_query)
    assert response.status_code == HTTPStatus.OK
    assert observed
    assert all(observed)
