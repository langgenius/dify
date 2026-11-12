"""Exercise Agent App creation and listing through real Console HTTP and SQLite."""

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.enums import TagType
from models.model import App, AppMode, AppModelConfig, Conversation, Tag, TagBinding
from repositories.agent_roster_repository import SQLAlchemyAgentRosterRepository
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.invite_options_store import AgentInviteOptionsPage
from services.enterprise.base import EnterpriseRequest
from services.entities.app_entities import AppListParams
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_workflow
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


def test_list_paginates_agents_and_counts_published_and_draft_apps(harness: Harness) -> None:
    first_id, first_app = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        first = session.get(Agent, first_id)
        assert first is not None
        first.name = "Published Agent"
        first.active_config_is_published = True
    second_id, second_app = harness.create_agent()
    response = harness.client.get("/console/api/agent?limit=10", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["total"] == 2
    assert body["has_more"] is False
    assert body["publication_counts"] == {"published": 1, "drafts": 1}
    by_id = {item["id"]: item for item in body["data"]}
    assert set(by_id) == {first_id, second_id}
    assert by_id[first_id]["app_id"] == first_app
    assert by_id[second_id]["app_id"] == second_app
    assert by_id[first_id]["active_config_is_published"] is True
    assert by_id[second_id]["active_config_is_published"] is False
    assert all(item["has_draft_trigger"] is False for item in body["data"])
    assert by_id[first_id]["debug_conversation_id"]
    assert by_id[second_id]["debug_conversation_id"]
    assert "bound_agent_id" not in by_id[first_id]
    assert isinstance(by_id[first_id]["permission_keys"], list)
    with harness.sessions() as session:
        mappings = session.scalars(
            select(AgentDebugConversation).where(AgentDebugConversation.agent_id.in_([first_id, second_id]))
        ).all()
        assert len(mappings) == 2
        assert {mapping.account_id for mapping in mappings} == {harness.account_id}
    published = harness.client.get("/console/api/agent?publication_status=published", headers=harness.headers)
    assert published.status_code == HTTPStatus.OK
    assert [item["id"] for item in published.get_json()["data"]] == [first_id]
    assert published.get_json()["publication_counts"] == {"published": 1, "drafts": 1}
    repeated = harness.client.get("/console/api/agent?limit=10", headers=harness.headers)
    repeated_by_id = {item["id"]: item for item in repeated.get_json()["data"]}
    assert repeated_by_id[first_id]["debug_conversation_id"] == by_id[first_id]["debug_conversation_id"]
    assert repeated_by_id[second_id]["debug_conversation_id"] == by_id[second_id]["debug_conversation_id"]


def test_list_applies_visible_agent_ids_before_pagination_and_counts(harness: Harness) -> None:
    first_id, first_app = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        first = session.get(Agent, first_id)
        assert first is not None
        first.name = "Published Agent"
        first.active_config_is_published = True
    _, second_app = harness.create_agent()
    with harness.sessions.begin() as session:
        for app_id in (first_app, second_app):
            app = session.get(App, app_id)
            assert app is not None
            app.maintainer = str(uuid4())
    repository = AgentAppRepository(session_factory=harness.sessions)
    context = RequestContext("test", None, harness.account_id, harness.tenant_id)
    result = repository.list_apps(context, AppListParams(mode="agent"), accessible_agent_ids={first_id})
    assert result.total == 1
    assert [item.agent_id for item in result.data] == [first_id]
    assert result.publication_counts.published == 1
    assert result.publication_counts.drafts == 0


def test_list_rolls_back_build_conversation_if_app_projection_fails(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get_one(App, app_id)
        config = AppModelConfig(app_id=app_id, model="invalid JSON")
        session.add(config)
        session.flush()
        app.app_model_config_id = config.id

    repository = AgentAppRepository(session_factory=harness.sessions)
    context = RequestContext("test", None, harness.account_id, harness.tenant_id)
    with pytest.raises(json.JSONDecodeError):
        repository.list_apps(context, AppListParams(mode="agent"), accessible_agent_ids=None)

    with harness.sessions() as session:
        assert (
            session.scalar(select(AgentDebugConversation.id).where(AgentDebugConversation.agent_id == agent_id)) is None
        )
        assert session.scalar(select(Conversation.id).where(Conversation.app_id == app_id)) is None


def test_list_resolves_rbac_visibility_through_enterprise_gateway(harness: Harness) -> None:
    first_id, first_app = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        first = session.get(Agent, first_id)
        assert first is not None
        first.name = "First Agent"
    second_id, second_app = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        for app_id in (first_app, second_app):
            app = session.get(App, app_id)
            assert app is not None
            app.maintainer = str(uuid4())
        for agent_id in (first_id, second_id):
            agent = session.get(Agent, agent_id)
            assert agent is not None
            assert agent.active_config_snapshot_id is not None
            agent.active_config_has_model = True
            session.add(
                AgentConfigSnapshot(
                    id=agent.active_config_snapshot_id,
                    tenant_id=harness.tenant_id,
                    agent_id=agent_id,
                    version=1,
                    config_snapshot=AgentSoulConfig(),
                )
            )

    whitelist: dict[str, object] = {"unrestricted": True, "resource_ids": []}
    permissions: dict[str, object] = {
        "agent": {"overrides": [{"resource_id": first_id, "permission_keys": ["agent.acl.preview"]}]}
    }
    requests: list[tuple[str, str | None, str | None]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            requests.append((path, self.headers.get("X-Inner-Tenant-Id"), self.headers.get("X-Inner-Account-Id")))
            if path == "/rbac/my-permissions":
                data = permissions
            elif path == "/rbac/agents/whitelist/resources":
                data = whitelist
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            payload = json.dumps(data).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    previous_url = EnterpriseRequest.rbac_base_url
    EnterpriseRequest.rbac_base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        response = harness.client.get("/console/api/agent", headers=harness.headers)
        assert response.status_code == HTTPStatus.OK
        assert {item["id"] for item in response.get_json()["data"]} == {first_id, second_id}
        invite = harness.client.get("/console/api/agent/invite-options", headers=harness.headers)
        assert invite.status_code == HTTPStatus.OK
        assert {item["id"] for item in invite.get_json()["data"]} == {first_id, second_id}
        assert requests == []

        with config_overrides_context(RBAC_ENABLED=True):
            response = harness.client.get("/console/api/agent", headers=harness.headers)
            assert response.status_code == HTTPStatus.OK
            assert [item["id"] for item in response.get_json()["data"]] == [first_id]
            invite = harness.client.get("/console/api/agent/invite-options", headers=harness.headers)
            assert invite.status_code == HTTPStatus.OK
            assert [item["id"] for item in invite.get_json()["data"]] == [first_id]

            whitelist.update(unrestricted=False, resource_ids=[second_id])
            response = harness.client.get("/console/api/agent", headers=harness.headers)
            assert response.status_code == HTTPStatus.OK
            assert [item["id"] for item in response.get_json()["data"]] == [second_id]
            invite = harness.client.get("/console/api/agent/invite-options", headers=harness.headers)
            assert invite.status_code == HTTPStatus.OK
            assert [item["id"] for item in invite.get_json()["data"]] == [second_id]

            whitelist.update(unrestricted=True, resource_ids=[])
            permissions.clear()
            response = harness.client.get("/console/api/agent", headers=harness.headers)
            assert response.status_code == HTTPStatus.OK
            assert response.get_json()["data"] == []
            assert response.get_json()["total"] == 0
            assert response.get_json()["has_more"] is False
            assert response.get_json()["publication_counts"] == {"published": 0, "drafts": 0}
            invite = harness.client.get("/console/api/agent/invite-options", headers=harness.headers)
            assert invite.status_code == HTTPStatus.OK
            assert invite.get_json()["data"] == []
            assert invite.get_json()["total"] == 0
            assert invite.get_json()["has_more"] is False

        assert requests == [
            (path, harness.tenant_id, harness.account_id)
            for _ in range(6)
            for path in ("/rbac/my-permissions", "/rbac/agents/whitelist/resources")
        ]
    finally:
        EnterpriseRequest.rbac_base_url = previous_url
        server.shutdown()
        thread.join()
        server.server_close()


def test_list_excludes_agents_from_another_workspace(harness: Harness) -> None:
    own_id, _ = harness.create_agent()
    foreign_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    response = harness.client.get("/console/api/agent", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    assert [item["id"] for item in response.get_json()["data"]] == [own_id]
    assert foreign_id != own_id


def test_invite_options_includes_roster_agent_without_app(harness: Harness) -> None:
    agent_id, snapshot_id = str(uuid4()), str(uuid4())
    with harness.sessions.begin() as session:
        session.add(
            Agent(
                id=agent_id,
                tenant_id=harness.tenant_id,
                name="Roster Agent",
                source=AgentSource.ROSTER,
                scope=AgentScope.ROSTER,
                active_config_snapshot_id=snapshot_id,
                active_config_has_model=True,
                created_by=harness.account_id,
            )
        )
        session.add(
            AgentConfigSnapshot(
                id=snapshot_id,
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                version=1,
                config_snapshot=AgentSoulConfig(),
            )
        )
    response = harness.client.get("/console/api/agent/invite-options", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    [item] = response.get_json()["data"]
    assert item["id"] == agent_id
    assert item["app_id"] is None
    assert item["backing_app_id"] is None


def test_invite_repository_closes_its_session_before_returning_detached_records(
    harness: Harness, sqlite_engine: Engine
) -> None:
    agent_id, _ = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        assert agent.active_config_snapshot_id is not None
        agent.active_config_has_model = True
        session.add(
            AgentConfigSnapshot(
                id=agent.active_config_snapshot_id,
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                version=1,
                config_snapshot=AgentSoulConfig(),
            )
        )

    closed: list[bool] = []

    class TrackingSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed.append(not self.in_transaction())

    repository = SQLAlchemyAgentRosterRepository(
        session_factory=sessionmaker(bind=sqlite_engine, class_=TrackingSession)
    )
    context = RequestContext("test", None, harness.account_id, harness.tenant_id)
    page = repository.list_invite_options(
        context, page=1, limit=20, keyword=None, app_id=None, accessible_agent_ids=None
    )
    assert closed == [True]
    assert isinstance(page, AgentInviteOptionsPage)
    assert page.data[0].id == agent_id
    assert page.data[0].active_config_snapshot is not None
    assert page.data[0].active_config_snapshot.version == 1


def test_invite_options_filters_callable_agents_and_reports_workflow_usage(harness: Harness) -> None:
    agent_id, _ = harness.create_agent(published=True)
    workflow_app_id, workflow_id = str(uuid4()), str(uuid4())
    published_workflow_id = str(uuid4())
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        assert agent.active_config_snapshot_id is not None
        agent.name = "Published Agent"
        agent.active_config_has_model = True
        session.add(
            AgentConfigSnapshot(
                id=agent.active_config_snapshot_id,
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                version=1,
                config_snapshot=AgentSoulConfig(),
            )
        )
        session.add(
            make_workflow(
                workflow_id=workflow_id,
                tenant_id=harness.tenant_id,
                app_id=workflow_app_id,
                version="draft",
                created_by=harness.account_id,
            )
        )
        session.add(
            App(
                id=workflow_app_id,
                tenant_id=harness.tenant_id,
                name="Published Flow",
                mode=AppMode.WORKFLOW,
                workflow_id=published_workflow_id,
                created_by=harness.account_id,
                maintainer=harness.account_id,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                app_id=workflow_app_id,
                workflow_id=published_workflow_id,
                workflow_version="v1",
                node_id="published-node",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id=agent.active_config_snapshot_id,
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                app_id=workflow_app_id,
                workflow_id=workflow_id,
                workflow_version="draft",
                node_id="node-1",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id=agent.active_config_snapshot_id,
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
    draft_id, _ = harness.create_agent()
    response = harness.client.get(
        f"/console/api/agent/invite-options?page=1&limit=1&app_id={workflow_app_id}", headers=harness.headers
    )
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["total"] == 1
    assert body["has_more"] is False
    [item] = body["data"]
    assert item["id"] == agent_id
    assert item["id"] != draft_id
    assert item["is_in_current_workflow"] is True
    assert item["in_current_workflow_count"] == 1
    assert item["existing_node_ids"] == ["node-1"]
    assert item["active_config_snapshot"]["id"] == item["active_config_snapshot_id"]
    assert item["published_reference_count"] == 1
    assert item["published_node_reference_count"] == 1
    assert item["published_references"][0]["app_id"] == workflow_app_id
    assert item["published_references"][0]["node_ids"] == ["published-node"]
    assert (
        harness.client.get("/console/api/agent/invite-options?limit=0", headers=harness.headers).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )


def test_list_empty_tag_match_returns_empty_page_and_counts(harness: Harness) -> None:
    harness.create_agent()
    response = harness.client.get(f"/console/api/agent?tag_ids={uuid4()}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "page": 1,
        "limit": 20,
        "total": 0,
        "has_more": False,
        "publication_counts": {"published": 0, "drafts": 0},
        "data": [],
    }


def test_list_preserves_tag_filter_and_model_projection(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        config = AppModelConfig(
            app_id=app_id,
            pre_prompt="Example prompt",
            model=json.dumps({"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}),
        )
        tag = Tag(tenant_id=harness.tenant_id, type=TagType.APP, name="Team", created_by=harness.account_id)
        session.add_all([config, tag])
        session.flush()
        app.app_model_config_id = config.id
        session.add(
            TagBinding(tenant_id=harness.tenant_id, tag_id=tag.id, target_id=app_id, created_by=harness.account_id)
        )
        tag_id = tag.id
    response = harness.client.get(f"/console/api/agent?tag_ids={tag_id}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    [item] = response.get_json()["data"]
    assert item["id"] == agent_id
    assert item["model_config"]["model"]["name"] == "gpt-4o"
    assert item["model_config"]["pre_prompt"] == "Example prompt"
    assert item["tags"] == [{"id": tag_id, "name": "Team", "type": "app"}]


def test_list_includes_distinct_published_workflow_references(harness: Harness) -> None:
    agent_id, _ = harness.create_agent(published=True)
    workflow_app_id, workflow_id = str(uuid4()), str(uuid4())
    with harness.sessions.begin() as session:
        workflow_app = App(
            id=workflow_app_id,
            tenant_id=harness.tenant_id,
            name="Example Flow",
            mode=AppMode.WORKFLOW,
            workflow_id=workflow_id,
            enable_site=False,
            enable_api=False,
            created_by=harness.account_id,
            maintainer=harness.account_id,
        )
        workflow = make_workflow(
            workflow_id=workflow_id,
            tenant_id=harness.tenant_id,
            app_id=workflow_app_id,
            version="v1",
            created_by=harness.account_id,
        )
        session.add_all([workflow_app, workflow])
        for node_id in ("node-a", "node-b"):
            session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=harness.tenant_id,
                    agent_id=agent_id,
                    app_id=workflow_app_id,
                    workflow_id=workflow_id,
                    workflow_version="v1",
                    node_id=node_id,
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    current_snapshot_id=str(uuid4()),
                    node_job_config=WorkflowNodeJobConfig(),
                )
            )
    response = harness.client.get("/console/api/agent", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    [item] = response.get_json()["data"]
    assert item["reference_count"] == 1
    assert item["published_reference_count"] == 1
    assert len(item["published_references"]) == 1
    assert item["published_references"][0]["app_id"] == workflow_app_id
    assert item["published_references"][0]["app_name"] == "Example Flow"


def test_create_returns_agent_detail_and_commits_app_and_agent(harness: Harness) -> None:
    response = harness.client.post(
        "/console/api/agent",
        headers=harness.headers,
        json={"name": "New Agent", "description": "Example", "role": "Helper"},
    )
    assert response.status_code == HTTPStatus.CREATED
    body = response.get_json()
    assert body["name"] == "New Agent"
    assert body["role"] == "Helper"
    assert body["debug_conversation_id"]
    assert body["enable_site"] is False
    assert body["enable_api"] is False
    assert body["site"]["title"] == "New Agent"
    with harness.sessions() as session:
        agent = session.get(Agent, body["id"])
        app = session.get(App, body["app_id"])
        assert agent is not None
        assert app is not None
        assert agent.app_id == app.id
        assert agent.tenant_id == app.tenant_id == harness.tenant_id
        assert app.mode == AppMode.AGENT
        assert agent.role == "Helper"


def test_create_omitted_role_and_duplicate_name(harness: Harness) -> None:
    first = harness.client.post("/console/api/agent", headers=harness.headers, json={"name": "Unique"})
    assert first.status_code == HTTPStatus.CREATED
    assert first.get_json()["role"] == ""
    duplicate = harness.client.post("/console/api/agent", headers=harness.headers, json={"name": "Unique"})
    assert duplicate.status_code == HTTPStatus.CONFLICT
    assert duplicate.get_json()["code"] == "agent_name_conflict_error"
    with harness.sessions() as session:
        agents = session.scalars(
            select(Agent).where(Agent.tenant_id == harness.tenant_id, Agent.name == "Unique")
        ).all()
        assert len(agents) == 1


def test_member_can_list_but_cannot_create(harness: Harness) -> None:
    with harness.sessions.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == harness.tenant_id, TenantAccountJoin.account_id == harness.account_id
            )
        )
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    assert harness.client.get("/console/api/agent", headers=harness.headers).status_code == HTTPStatus.OK
    assert (
        harness.client.post("/console/api/agent", headers=harness.headers, json={"name": "Forbidden"}).status_code
        == HTTPStatus.FORBIDDEN
    )
    with harness.sessions() as session:
        assert (
            session.scalar(select(Agent.id).where(Agent.tenant_id == harness.tenant_id, Agent.name == "Forbidden"))
            is None
        )
