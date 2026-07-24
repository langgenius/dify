"""Publication visibility rules for calling roster Agents from Workflows.

``Agent.active_config_is_published`` describes whether the editable shared
draft still matches the active snapshot. It is false both before the first
publish and after a published Agent receives new draft edits, so it must not be
used as a runtime availability flag. App-backed Agents are callable from a
Workflow only when the active snapshot has a revision created by a
publish-visible operation. Direct roster Agents are publish-visible by
construction and only need an active snapshot.
"""

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentScope, AgentSource

PUBLISH_VISIBLE_APP_BACKED_REVISION_OPERATIONS = frozenset(
    {
        AgentConfigRevisionOperation.PUBLISH_DRAFT,
        AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
        AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        AgentConfigRevisionOperation.SAVE_NEW_AGENT,
        AgentConfigRevisionOperation.SAVE_TO_ROSTER,
        AgentConfigRevisionOperation.RESTORE_VERSION,
    }
)


def workflow_callable_active_snapshot_filter() -> ColumnElement[bool]:
    """Return the SQL predicate for an Agent with a Workflow-callable active snapshot.

    The caller remains responsible for tenant, roster scope, lifecycle status,
    and model configuration filters. The correlated revision lookup makes the
    predicate safe to compose into roster pagination queries.
    """

    app_backed_agent = or_(
        Agent.source == AgentSource.AGENT_APP,
        and_(
            Agent.source == AgentSource.IMPORTED,
            Agent.scope == AgentScope.ROSTER,
            Agent.app_id.is_not(None),
        ),
    )
    publish_visible_revision_exists = (
        select(AgentConfigRevision.id)
        .where(
            AgentConfigRevision.tenant_id == Agent.tenant_id,
            AgentConfigRevision.agent_id == Agent.id,
            AgentConfigRevision.current_snapshot_id == Agent.active_config_snapshot_id,
            AgentConfigRevision.operation.in_(PUBLISH_VISIBLE_APP_BACKED_REVISION_OPERATIONS),
        )
        .correlate(Agent)
        .exists()
    )
    return and_(
        Agent.active_config_snapshot_id.is_not(None),
        or_(
            ~app_backed_agent,
            publish_visible_revision_exists,
        ),
    )


def agent_has_workflow_callable_active_snapshot(*, session: Session, agent: Agent) -> bool:
    """Return whether ``agent`` has an active snapshot visible to Workflow.

    This object-level form is useful after ownership and lifecycle checks have
    already loaded an Agent. It intentionally ignores dirty draft state so a
    previously published snapshot keeps serving while later edits remain
    unpublished.
    """

    if not agent.active_config_snapshot_id:
        return False
    is_app_backed = agent.source == AgentSource.AGENT_APP or (
        agent.source == AgentSource.IMPORTED and agent.scope == AgentScope.ROSTER and agent.app_id is not None
    )
    if not is_app_backed:
        return True
    return bool(
        session.scalar(
            select(AgentConfigRevision.id)
            .where(
                AgentConfigRevision.tenant_id == agent.tenant_id,
                AgentConfigRevision.agent_id == agent.id,
                AgentConfigRevision.current_snapshot_id == agent.active_config_snapshot_id,
                AgentConfigRevision.operation.in_(PUBLISH_VISIBLE_APP_BACKED_REVISION_OPERATIONS),
            )
            .limit(1)
        )
    )
