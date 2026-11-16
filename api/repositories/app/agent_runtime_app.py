"""Resolve Agent runtime Apps in a caller-owned SQLAlchemy session."""

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from constants.model_template import default_app_templates
from models.agent import APP_BACKED_AGENT_SOURCES, WORKFLOW_ONLY_AGENT_SOURCES, Agent, AgentScope, AgentStatus
from models.enums import AppStatus
from models.model import App, AppMode, AppModelConfig, IconType


def create_hidden_backing_app(
    session: Session,
    *,
    tenant_id: str,
    account_id: str | None,
    name: str,
    description: str = "",
    icon_type: str | None = None,
    icon: str | None = None,
    icon_background: str | None = None,
) -> App:
    """Create an internal Agent App used only to back a workflow-only Agent.

    This deliberately bypasses AppService.create_app because that public
    creation path also creates a roster Agent. Inline Agents need App runtime
    infrastructure for chat/logs/monitoring, but must stay hidden from the
    workspace Agent Roster until explicitly saved to roster. Flushes the App
    and its model config in the caller's transaction.
    """

    app_template = dict(default_app_templates[AppMode.AGENT]["app"])
    app = App(**app_template)
    app.name = name
    app.description = description or ""
    app.mode = AppMode.AGENT
    app.icon_type = IconType(icon_type) if icon_type else IconType.EMOJI
    app.icon = icon
    app.icon_background = icon_background
    app.tenant_id = tenant_id
    app.enable_site = False
    app.enable_api = False
    app.api_rph = 0
    app.api_rpm = 0
    app.max_active_requests = None
    app.created_by = account_id
    app.maintainer = account_id
    app.updated_by = account_id
    session.add(app)
    session.flush()

    app_model_config = AppModelConfig(app_id=app.id, created_by=account_id, updated_by=account_id)
    session.add(app_model_config)
    session.flush()
    app.app_model_config_id = app_model_config.id
    session.flush()
    return app


def ensure_workflow_agent_backing_app(session: Session, *, agent: Agent, account_id: str | None) -> str | None:
    """Return the Agent's runtime App id, staging a hidden App for workflow-only Agents as needed."""
    if agent.scope != AgentScope.WORKFLOW_ONLY or agent.backing_app_id:
        return agent.backing_app_id or agent.app_id
    backing_app = create_hidden_backing_app(
        session,
        tenant_id=agent.tenant_id,
        account_id=account_id or agent.updated_by or agent.created_by,
        name=agent.name,
        description=agent.description,
        icon_type=agent.icon_type,
        icon=agent.icon,
        icon_background=agent.icon_background,
    )
    agent.backing_app_id = backing_app.id
    session.flush()
    return backing_app.id


def find_runtime_resolvable_agent(session: Session, *, tenant_id: str, agent_id: str) -> Agent | None:
    """Load an Agent that is eligible to resolve to a runtime backing App.

    Shared by the runtime resolvers and the read-only authorization resolver
    so both agree on what counts as a resolvable Agent.
    """

    return session.scalar(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.id == agent_id,
            Agent.status == AgentStatus.ACTIVE,
            or_(
                and_(Agent.scope == AgentScope.ROSTER, Agent.source.in_(APP_BACKED_AGENT_SOURCES)),
                and_(
                    Agent.scope == AgentScope.WORKFLOW_ONLY,
                    Agent.source.in_(WORKFLOW_ONLY_AGENT_SOURCES),
                    Agent.workflow_id.is_not(None),
                    Agent.workflow_node_id.is_not(None),
                ),
            ),
        )
        .limit(1)
    )


def find_runtime_app(session: Session, *, tenant_id: str, app_id: str) -> App | None:
    """Return the normal Agent runtime App in the supplied tenant, or None if it is missing."""
    return session.scalar(
        select(App)
        .where(
            App.tenant_id == tenant_id,
            App.id == app_id,
            App.mode == AppMode.AGENT,
            App.status == AppStatus.NORMAL,
        )
        .limit(1)
    )


def resolve_agent_runtime_app(session: Session, *, tenant_id: str, agent_id: str) -> App | None:
    """Resolve the tenant's runtime App and persist any missing workflow-only backing App.

    The caller supplies a session with no unrelated writes. A newly materialized
    backing App is committed before downstream reads, as in the legacy runtime
    path. An ineligible Agent or unavailable App returns None.
    """
    agent = find_runtime_resolvable_agent(session, tenant_id=tenant_id, agent_id=agent_id)
    if agent is None:
        return None
    created = agent.scope == AgentScope.WORKFLOW_ONLY and not agent.backing_app_id
    app_id = ensure_workflow_agent_backing_app(session, agent=agent, account_id=agent.updated_by or agent.created_by)
    if not app_id:
        return None
    if created:
        session.commit()
    return find_runtime_app(session, tenant_id=tenant_id, app_id=app_id)
