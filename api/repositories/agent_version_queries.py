"""Session-scoped queries for Agent version visibility."""

from sqlalchemy import select
from sqlalchemy.sql.selectable import Subquery

from models.agent import (
    AGENT_APP_VERSION_OPERATIONS,
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentScope,
    AgentSource,
)


def visible_version_operations(agent: Agent) -> set[AgentConfigRevisionOperation]:
    """Return the revision operations visible for the Agent's source and scope."""
    if agent.source == AgentSource.AGENT_APP or (
        agent.source == AgentSource.IMPORTED and agent.scope == AgentScope.ROSTER and agent.app_id
    ):
        operations = set(AGENT_APP_VERSION_OPERATIONS)
    else:
        operations = {
            AgentConfigRevisionOperation.CREATE_VERSION,
            AgentConfigRevisionOperation.SAVE_NEW_VERSION,
            AgentConfigRevisionOperation.SAVE_NEW_AGENT,
            AgentConfigRevisionOperation.SAVE_TO_ROSTER,
            AgentConfigRevisionOperation.RESTORE_VERSION,
        }
    if agent.source == AgentSource.IMPORTED:
        operations.add(AgentConfigRevisionOperation.IMPORT_PACKAGE)
    return operations


def visible_version_ids(*, tenant_id: str, agent_id: str, agent: Agent) -> Subquery:
    """Build the existing roster-visible snapshot filter for the given owner."""
    return (
        select(AgentConfigRevision.current_snapshot_id)
        .where(
            AgentConfigRevision.tenant_id == tenant_id,
            AgentConfigRevision.agent_id == agent_id,
            AgentConfigRevision.operation.in_(visible_version_operations(agent)),
        )
        .subquery()
    )
