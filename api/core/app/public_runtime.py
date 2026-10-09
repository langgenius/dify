"""Publication admission shared by public Web App identity and passport reads.

This is not a Console/Debug visibility rule. Published pointers keep serving
while a newer draft is edited; an Agent's dirty-draft flag is not a publication
gate. Every referenced artifact must still belong to this App and workspace.
"""

from sqlalchemy import and_, or_, select
from sqlalchemy.sql.elements import ColumnElement

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from models.agent import APP_BACKED_AGENT_SOURCES, Agent, AgentConfigSnapshot, AgentScope, AgentStatus
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow


def published_app_filter() -> ColumnElement[bool]:
    """Match Apps with a live published artifact, without loading private content.

    Callers additionally own App/Site lifecycle and authentication checks. The
    predicate performs only reads and can be reused inside passport issuance's
    bounded transaction before creating or reusing an EndUser.
    """
    published_workflow = (
        select(Workflow.id)
        .where(
            Workflow.id == App.workflow_id,
            Workflow.app_id == App.id,
            Workflow.tenant_id == App.tenant_id,
            Workflow.version != "draft",
        )
        .correlate(App)
        .exists()
    )
    published_model_config = (
        select(AppModelConfig.id)
        .where(AppModelConfig.id == App.app_model_config_id, AppModelConfig.app_id == App.id)
        .correlate(App)
        .exists()
    )
    published_agent = (
        select(Agent.id)
        .join(
            AgentConfigSnapshot,
            and_(
                AgentConfigSnapshot.id == Agent.active_config_snapshot_id,
                AgentConfigSnapshot.agent_id == Agent.id,
                AgentConfigSnapshot.tenant_id == Agent.tenant_id,
            ),
        )
        .where(
            Agent.app_id == App.id,
            Agent.tenant_id == App.tenant_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
            workflow_callable_active_snapshot_filter(),
        )
        .correlate(App)
        .exists()
    )
    return or_(
        and_(App.mode.in_((AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)), published_workflow),
        and_(App.mode.in_((AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT)), published_model_config),
        and_(App.mode == AppMode.AGENT, published_agent),
    )
