"""SQL fixtures shared by unit and normal-CI native Builder Agent cases."""

import json
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session

from core.dify_builder.models import Actor
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App
from models.workflow import Workflow


@dataclass
class AgentCase:
    actor: Actor
    workflow: Workflow
    agent: Agent
    snapshot: AgentConfigSnapshot


def add_agent(
    session: Session,
    *,
    tenant_id: str,
    name: str,
    published: bool = True,
    source: AgentSource = AgentSource.AGENT_APP,
    status: AgentStatus = AgentStatus.ACTIVE,
) -> tuple[Agent, AgentConfigSnapshot]:
    agent = Agent(
        tenant_id=tenant_id,
        name=name,
        scope=AgentScope.ROSTER,
        source=source,
        status=status,
        active_config_has_model=True,
    )
    session.add(agent)
    session.flush()
    snapshot = AgentConfigSnapshot(
        tenant_id=tenant_id,
        agent_id=agent.id,
        version=1,
        summary="Published risk review",
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "model": {"plugin_id": "model-plugin", "model_provider": "provider", "model": "test-model"},
                "app_variables": [{"name": "report", "type": "string", "required": True}],
                "tools": {
                    "dify_tools": [
                        {
                            "provider_type": "builtin",
                            "provider_id": "plugin/provider",
                            "tool_name": "read",
                            "credential_type": "unauthorized",
                            "runtime_parameters": {"private": "HIDDEN"},
                        }
                    ]
                },
            }
        ),
    )
    session.add(snapshot)
    session.flush()
    agent.active_config_snapshot_id = snapshot.id
    if published:
        session.add(
            AgentConfigRevision(
                tenant_id=tenant_id,
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=1,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
        )
    session.flush()
    return agent, snapshot


def make_case(session: Session) -> AgentCase:
    tenant = Tenant(name="Builder Agent tests")
    account = Account(name="Builder Agent actor", email=f"{uuid4()}@example.invalid")
    session.add_all([tenant, account])
    session.flush()
    session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
    app = App(
        tenant_id=tenant.id,
        name="Builder test",
        mode="workflow",
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        kind="standard",
        version="draft",
        graph=json.dumps(
            {
                "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}],
                "edges": [{"source": "start", "target": "review"}],
            }
        ),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=account.id,
    )
    session.add(workflow)
    agent, snapshot = add_agent(session, tenant_id=tenant.id, name="Reviewer")
    session.flush()
    return AgentCase(Actor(tenant_id=tenant.id, account_id=account.id), workflow, agent, snapshot)
