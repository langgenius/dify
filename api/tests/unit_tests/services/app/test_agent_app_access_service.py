"""Published Agent App references use the canonical roster query."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.agent import build_agent_app_services
from machinery.context import RequestContext
from models.agent import (
    Agent,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import WorkflowNodeJobConfig
from models.model import AppMode
from services.app.agent_app_contracts import AgentAppNotFoundError
from tests.unit_tests.model_factories import make_app


def test_access_only_lists_current_published_workflow_references(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    sqlite_session.add_all(
        [
            make_app(app_id="agent-app", mode=AppMode.AGENT),
            make_app(app_id="workflow-app", mode=AppMode.WORKFLOW, workflow_id="published"),
            make_app(app_id="foreign-app", tenant_id="foreign", mode=AppMode.WORKFLOW, workflow_id="foreign-workflow"),
            Agent(
                id="agent",
                tenant_id="tenant-1",
                name="Agent",
                description="",
                app_id="agent-app",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                status=AgentStatus.ACTIVE,
            ),
        ]
    )
    for node_id, app_id, workflow_id, version, tenant_id in (
        ("node-b", "workflow-app", "published", "v1", "tenant-1"),
        ("node-a", "workflow-app", "published", "v1", "tenant-1"),
        ("draft-node", "workflow-app", "draft", "draft", "tenant-1"),
        ("old-node", "workflow-app", "old", "v0", "tenant-1"),
        ("foreign-node", "foreign-app", "foreign-workflow", "v1", "foreign"),
    ):
        sqlite_session.add(
            WorkflowAgentNodeBinding(
                tenant_id=tenant_id,
                agent_id="agent",
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version=version,
                node_id=node_id,
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="snapshot",
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
    sqlite_session.commit()
    service = build_agent_app_services(database_client=sqlite_session_factory).access
    context = RequestContext("request", None, "account", "tenant-1")
    [reference] = service.list_referencing_workflows(context, "agent")
    assert reference["app_id"] == "workflow-app"
    assert reference["workflow_id"] == "published"
    assert reference["node_ids"] == ["node-a", "node-b"]
    with pytest.raises(AgentAppNotFoundError):
        service.list_referencing_workflows(context._replace(active_workspace_id="foreign"), "agent")


@pytest.mark.parametrize("invalid", ["archived", "standalone", "workflow-only", "missing-app"])
def test_access_requires_public_agent_app(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], invalid: str
) -> None:
    agent = Agent(
        id="agent",
        tenant_id="tenant-1",
        name="Agent",
        description="",
        app_id="agent-app",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    if invalid == "archived":
        agent.status = AgentStatus.ARCHIVED
    elif invalid == "standalone":
        agent.source = AgentSource.ROSTER
    elif invalid == "workflow-only":
        agent.scope = AgentScope.WORKFLOW_ONLY
    else:
        agent.app_id = "missing"
    sqlite_session.add_all([make_app(app_id="agent-app", mode=AppMode.AGENT), agent])
    sqlite_session.commit()
    service = build_agent_app_services(database_client=sqlite_session_factory).access
    with pytest.raises(AgentAppNotFoundError):
        service.list_referencing_workflows(RequestContext("request", None, "account", "tenant-1"), "agent")
