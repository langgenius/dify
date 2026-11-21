"""Real role/App-scope admission for External asset reference preflight."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentContextSlot, ExternalAgentHead
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.external_agents.contracts import ExternalAgentForbiddenError


def _seed_asset(sessions: sessionmaker[Session], role: TenantAccountRole | None) -> tuple[RequestContext, str, str]:
    """Persist actual control-plane ownership; None intentionally omits membership."""
    with sessions.begin() as session:
        tenant, account = Tenant(name="Reference workspace"), Account(name="Reader", email="reference@example.test")
        session.add_all((tenant, account))
        session.flush()
        if role is not None:
            session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=role))
        agent = Agent(
            tenant_id=tenant.id,
            name="External",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            agent_kind=AgentKind.EXTERNAL_A2A,
        )
        session.add(agent)
        session.flush()
        revision_id = str(uuid4())
        session.add(
            ExternalAgentConnectionRevision(
                id=revision_id,
                tenant_id=tenant.id,
                agent_id=agent.id,
                endpoint="https://example.test",
                interface_url="https://example.test",
                auth_type="none",
                credential_ciphertext=None,
                agent_card={"name": "External"},
                capabilities={},
                fingerprint="a" * 64,
                auth_check="not_exercised",
                created_by=account.id,
                verified_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        session.add(
            ExternalAgentHead(agent_id=agent.id, tenant_id=tenant.id, active_connection_revision_id=revision_id)
        )
        return RequestContext("references", None, account.id, tenant.id), agent.id, revision_id


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, None, TenantAccountRole.DATASET_OPERATOR])
def test_reference_details_reject_non_detail_roles_before_querying_any_app(
    role: TenantAccountRole | None,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    account_application_services: ApplicationServices,
) -> None:
    """A coarse roster/Monitoring role cannot read any reference or in-flight rows."""
    context, agent_id, _ = _seed_asset(sqlite_session_factory, role)
    statements: list[str] = []

    def record(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement.lower())

    event.listen(sqlite_engine, "before_cursor_execute", record)
    try:
        with pytest.raises(ExternalAgentForbiddenError):
            account_application_services.external_agents.assets.references(context, agent_id)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record)
    assert not any(
        table in statement
        for table in ("workflow_agent_node_bindings", "external_agent_invocations", "external_agent_context_slots")
        for statement in statements
    )


def test_reference_details_preserve_empty_admitted_app_scope_with_real_persistence(
    sqlite_session_factory: sessionmaker[Session], account_application_services: ApplicationServices
) -> None:
    """An empty App scope hides a real reference while retaining its coarse warning."""
    context, agent_id, revision_id = _seed_asset(sqlite_session_factory, TenantAccountRole.EDITOR)
    app_id, workflow_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=context.active_workspace_id,
                name="Hidden app",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(
            Workflow(
                id=workflow_id,
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph="{}",
                _features="{}",
                created_by=context.account_id,
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version=Workflow.VERSION_DRAFT,
                node_id="external",
                agent_id=agent_id,
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
        session.add(
            ExternalAgentContextSlot(
                key="unresolved-reference",
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                conversation_id=str(uuid4()),
                node_id="external",
                agent_id=agent_id,
                connection_revision_id=revision_id,
                binding_epoch="epoch",
                unresolved=True,
            )
        )
    restricted = context._replace(resource_app_ids=frozenset())
    references = account_application_services.external_agents.assets.references(restricted, agent_id)
    assert references.apps == ()
    assert references.may_have_in_flight is True
    readable = account_application_services.external_agents.assets.references(context, agent_id)
    assert len(readable.apps) == 1
    assert readable.apps[0].app_id == app_id
    assert readable.apps[0].name == "Hidden app"
    assert readable.apps[0].node_ids == ("external",)
