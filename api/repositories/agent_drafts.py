"""Shared draft persistence for the Build repository and the legacy composer."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot, AgentScope
from models.agent_config_entities import AgentSoulConfig
from repositories.agent_roster_queries import find_agent_draft
from services.app.agent_build_session_store import AgentBuildAgentNotFoundError, AgentBuildBaseUnavailableError


def find_agent_snapshot(
    *, session: Session, tenant_id: str, agent_id: str, version_id: str | None
) -> AgentConfigSnapshot | None:
    """Load a snapshot only within the supplied tenant and Agent scope, or None if absent."""
    if not version_id:
        return None
    return session.scalar(
        select(AgentConfigSnapshot).where(
            AgentConfigSnapshot.tenant_id == tenant_id,
            AgentConfigSnapshot.agent_id == agent_id,
            AgentConfigSnapshot.id == version_id,
        )
    )


def rebase_workflow_only_normal_draft(
    *,
    agent: Agent,
    draft: AgentConfigDraft,
    snapshot: AgentConfigSnapshot,
    updated_by: str | None,
) -> bool:
    """Sync a stale normal Draft's base_snapshot_id, home_snapshot_id, config_snapshot, and updated_by."""

    if (
        agent.scope != AgentScope.WORKFLOW_ONLY
        or draft.draft_type != AgentConfigDraftType.DRAFT
        or draft.account_id is not None
        or not agent.active_config_snapshot_id
        or draft.base_snapshot_id == agent.active_config_snapshot_id
        or snapshot.id != agent.active_config_snapshot_id
    ):
        return False
    draft.base_snapshot_id = snapshot.id
    draft.home_snapshot_id = snapshot.home_snapshot_id
    draft.config_snapshot = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
    draft.updated_by = updated_by
    return True


def get_or_create_agent_draft(
    *,
    session: Session,
    tenant_id: str,
    agent: Agent,
    draft_type: AgentConfigDraftType,
    account_id: str | None,
    created_by: str | None,
) -> AgentConfigDraft:
    """Resolve the current owner-scoped draft under lock, seeding it from the active snapshot when absent."""
    # All draft writers lock the parent before checking for an absent draft.
    # Locking a draft query alone cannot serialize concurrent first writes.
    # Preserve caller-owned Agent edits before refreshing its locked database state.
    # An UPDATE itself acquires the parent lock; do not flush an older cached Draft here.
    session.flush([agent])
    locked_agent = session.scalar(
        select(Agent)
        .where(Agent.tenant_id == tenant_id, Agent.id == agent.id)
        .with_for_update()
        .execution_options(populate_existing=True, autoflush=False)
    )
    if locked_agent is None:
        raise AgentBuildAgentNotFoundError
    agent = locked_agent
    draft = find_agent_draft(
        session=session,
        tenant_id=tenant_id,
        agent_id=agent.id,
        draft_type=draft_type,
        account_id=account_id,
        for_update=True,
    )
    if draft is not None:
        if (
            agent.scope == AgentScope.WORKFLOW_ONLY
            and draft_type == AgentConfigDraftType.DRAFT
            and draft.account_id is None
            and agent.active_config_snapshot_id
            and draft.base_snapshot_id != agent.active_config_snapshot_id
        ):
            active_snapshot = find_agent_snapshot(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent.id,
                version_id=agent.active_config_snapshot_id,
            )
            if active_snapshot is None:
                raise AgentBuildBaseUnavailableError
            if rebase_workflow_only_normal_draft(
                agent=agent,
                draft=draft,
                snapshot=active_snapshot,
                updated_by=agent.updated_by or agent.created_by,
            ):
                session.flush()
        return draft
    base_snapshot = find_agent_snapshot(
        session=session,
        tenant_id=tenant_id,
        agent_id=agent.id,
        version_id=agent.active_config_snapshot_id,
    )
    if base_snapshot is None:
        raise AgentBuildBaseUnavailableError
    agent_soul = AgentSoulConfig.model_validate(base_snapshot.config_snapshot_dict)
    draft = AgentConfigDraft(
        tenant_id=tenant_id,
        agent_id=agent.id,
        draft_type=draft_type,
        account_id=account_id if draft_type == AgentConfigDraftType.DEBUG_BUILD else None,
        draft_owner_key=account_id if draft_type == AgentConfigDraftType.DEBUG_BUILD and account_id else "",
        base_snapshot_id=base_snapshot.id,
        home_snapshot_id=base_snapshot.home_snapshot_id,
        config_snapshot=agent_soul,
        created_by=created_by,
        updated_by=created_by,
    )
    session.add(draft)
    session.flush()
    return draft


def save_agent_draft(
    *,
    session: Session,
    tenant_id: str,
    agent: Agent,
    draft_type: AgentConfigDraftType,
    account_id: str | None,
    agent_soul: AgentSoulConfig,
    account_id_for_audit: str,
    base_snapshot_id: str | None = None,
) -> AgentConfigDraft:
    """Stage the Soul update in the caller's transaction, keeping omitted config files from the locked draft."""
    draft = get_or_create_agent_draft(
        session=session,
        tenant_id=tenant_id,
        agent=agent,
        draft_type=draft_type,
        account_id=account_id,
        created_by=account_id_for_audit,
    )
    draft.config_snapshot = preserve_omitted_config_files(
        agent_soul, AgentSoulConfig.model_validate(draft.config_snapshot_dict)
    )
    if base_snapshot_id is not None:
        draft.base_snapshot_id = base_snapshot_id
    elif draft.base_snapshot_id is None:
        draft.base_snapshot_id = agent.active_config_snapshot_id
    draft.updated_by = account_id_for_audit
    if draft_type == AgentConfigDraftType.DRAFT and account_id is None:
        agent.active_config_is_published = False
    session.flush()
    return draft


def preserve_omitted_config_files(agent_soul: AgentSoulConfig, current_soul: AgentSoulConfig) -> AgentSoulConfig:
    """An omitted asset list preserves the locked state; an explicit list replaces it, including an empty one."""
    if "config_files" in agent_soul.model_fields_set:
        return agent_soul
    return agent_soul.model_copy(update={"config_files": current_soul.config_files})


def _agent_soul_config_json(agent_soul: AgentSoulConfig | dict[str, Any]) -> dict[str, Any]:
    """Normalize a validated or stored Soul for configuration equality."""
    return AgentSoulConfig.model_validate(agent_soul).model_dump(mode="json")


def agent_soul_matches_active_config(
    *,
    session: Session,
    tenant_id: str,
    agent: Agent,
    agent_soul: AgentSoulConfig,
    home_snapshot_id: str | None,
) -> bool:
    """Compare Soul and Home with the Agent's callable active snapshot within the caller's transaction."""
    if not agent.active_config_snapshot_id:
        return False

    active_version = find_agent_snapshot(
        session=session,
        tenant_id=tenant_id,
        agent_id=agent.id,
        version_id=agent.active_config_snapshot_id,
    )
    if not active_version:
        return False
    if not agent_has_workflow_callable_active_snapshot(session=session, agent=agent):
        return False

    return home_snapshot_id == active_version.home_snapshot_id and _agent_soul_config_json(
        agent_soul
    ) == _agent_soul_config_json(active_version.config_snapshot_dict)
