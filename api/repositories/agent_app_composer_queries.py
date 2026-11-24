"""Read and project Agent Composer configuration in an existing transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.helper import to_timestamp
from models.agent import Agent, AgentConfigDraftType, AgentConfigSnapshot, AgentScope
from repositories.agent_drafts import find_agent_snapshot
from repositories.agent_roster_queries import find_agent_draft, project_agent_draft_summary
from services.agent.app_composer_store import (
    AgentComposerAgentMissingError,
    AgentComposerIdentity,
    AgentComposerSnapshot,
    AgentComposerSnapshotMissingError,
    AgentComposerState,
)
from services.entities.agent_entities import ComposerSaveStrategy


def require_composer_agent(session: Session, *, tenant_id: str, agent_id: str) -> Agent:
    """Find the requested tenant's Agent, including workflow-only and archived Agents."""
    agent = session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id))
    if agent is None:
        raise AgentComposerAgentMissingError
    return agent


def composer_identity(agent: Agent) -> AgentComposerIdentity:
    """Detach identity fields shared by Agent and workflow Composer responses."""
    return AgentComposerIdentity(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        role=agent.role,
        icon_type=agent.icon_type,
        icon=agent.icon,
        icon_background=agent.icon_background,
        scope=agent.scope.value,
        source=agent.source.value,
        status=agent.status.value,
        app_id=agent.app_id,
        backing_app_id=agent.backing_app_id or agent.app_id,
        hidden_app_backed=bool(agent.scope == AgentScope.WORKFLOW_ONLY and agent.backing_app_id),
        active_config_snapshot_id=agent.active_config_snapshot_id,
    )


def composer_snapshot(version: AgentConfigSnapshot | None) -> AgentComposerSnapshot | None:
    """Detach snapshot audit metadata using the Composer's historical version numbering."""
    if version is None:
        return None
    return AgentComposerSnapshot(
        id=version.id,
        version=version.version,
        version_note=version.version_note,
        created_by=version.created_by,
        created_at=to_timestamp(version.created_at),
    )


def read_composer_state(session: Session, *, agent: Agent, published_only: bool = False) -> AgentComposerState:
    """Read the effective Soul while preserving metadata of a stale workflow-only draft."""
    draft = (
        None
        if published_only
        else find_agent_draft(
            session,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
        )
    )
    version = find_agent_snapshot(
        session=session, tenant_id=agent.tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
    )
    if draft is None or (
        agent.scope == AgentScope.WORKFLOW_ONLY
        and agent.active_config_snapshot_id
        and draft.base_snapshot_id != agent.active_config_snapshot_id
    ):
        if version is None:
            raise AgentComposerSnapshotMissingError
        soul = version.config_snapshot_dict
    else:
        soul = draft.config_snapshot_dict
    identity = composer_identity(agent)
    return AgentComposerState(
        agent=identity,
        active_config_snapshot=composer_snapshot(version),
        active_config_is_published=published_only
        or bool(agent.active_config_snapshot_id and agent.active_config_is_published),
        draft=project_agent_draft_summary(draft) if draft else None,
        agent_soul=soul,
        save_options=() if published_only else (ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,),
        app_id=identity.app_id,
        backing_app_id=identity.backing_app_id,
        hidden_app_backed=identity.hidden_app_backed,
        chat_endpoint=f"/console/api/agent/{agent.id}/chat-messages",
    )
