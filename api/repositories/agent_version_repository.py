"""Tenant-scoped persistence for Agent version history and shared-draft restoration."""

from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import to_timestamp
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentScope,
)
from models.agent_config_entities import AgentSoulConfig
from repositories.agent_version_queries import visible_version_ids
from services.agent.version_store import (
    AgentVersionDetail,
    AgentVersionRestored,
    AgentVersionRevision,
    AgentVersionSummary,
    AgentVersionUnavailableError,
    VersionAgentNotFoundError,
)


def _agent(session: Session, tenant_id: str, agent_id: str) -> Agent:
    """Load a tenant-owned roster Agent, preserving the legacy archived-Agent behavior."""
    agent = session.scalar(
        select(Agent)
        .where(Agent.tenant_id == tenant_id, Agent.id == agent_id, Agent.scope == AgentScope.ROSTER)
        .limit(1)
    )
    if agent is None:
        raise VersionAgentNotFoundError
    return agent


def _visible_versions(session: Session, tenant_id: str, agent: Agent) -> list[AgentConfigSnapshot]:
    """Load the owner's visible immutable snapshots in chronological sequence."""
    visible_ids = visible_version_ids(tenant_id=tenant_id, agent_id=agent.id, agent=agent)
    return list(
        session.scalars(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
                AgentConfigSnapshot.id.in_(select(visible_ids.c.current_snapshot_id)),
            )
            .order_by(AgentConfigSnapshot.version.asc())
        ).all()
    )


def _summary(snapshot: AgentConfigSnapshot, display_version: int) -> AgentVersionSummary:
    """Map an immutable snapshot to its user-visible and underlying sequence numbers."""
    return AgentVersionSummary(
        id=snapshot.id,
        agent_id=snapshot.agent_id,
        version=display_version,
        display_version=display_version,
        snapshot_version=snapshot.version,
        summary=snapshot.summary,
        version_note=snapshot.version_note,
        created_by=snapshot.created_by,
        created_at=to_timestamp(snapshot.created_at),
    )


class SQLAlchemyAgentVersionRepository:
    """Return detached version records and atomically restore one owner's shared draft."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_versions(self, *, tenant_id: str, agent_id: str) -> list[AgentVersionSummary]:
        """Return visible history newest first with contiguous display numbers."""
        with self._session_factory() as session:
            snapshots = _visible_versions(session, tenant_id, _agent(session, tenant_id, agent_id))
            return [_summary(snapshot, number) for number, snapshot in reversed(list(enumerate(snapshots, start=1)))]

    def get_version(self, *, tenant_id: str, agent_id: str, version_id: str) -> AgentVersionDetail:
        """Return a visible snapshot and its tenant- and Agent-scoped audit revisions."""
        with self._session_factory() as session:
            snapshots = _visible_versions(session, tenant_id, _agent(session, tenant_id, agent_id))
            matches = [(number, item) for number, item in enumerate(snapshots, start=1) if item.id == version_id]
            if not matches:
                raise AgentVersionUnavailableError
            number, snapshot = matches[0]
            revisions = session.scalars(
                select(AgentConfigRevision)
                .where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                    AgentConfigRevision.current_snapshot_id == version_id,
                )
                .order_by(AgentConfigRevision.revision.desc())
            ).all()
            return AgentVersionDetail(
                **asdict(_summary(snapshot, number)),
                config_snapshot=snapshot.config_snapshot_dict,
                revisions=[
                    AgentVersionRevision(
                        id=item.id,
                        previous_snapshot_id=item.previous_snapshot_id,
                        current_snapshot_id=item.current_snapshot_id,
                        revision=item.revision,
                        operation=item.operation.value,
                        summary=item.summary,
                        version_note=item.version_note,
                        created_by=item.created_by,
                        created_at=to_timestamp(item.created_at),
                    )
                    for item in revisions
                ],
            )

    def restore_version(
        self, *, tenant_id: str, agent_id: str, version_id: str, account_id: str
    ) -> AgentVersionRestored:
        """Commit the visible snapshot and its home reference to the Agent's shared draft."""
        with self._session_factory.begin() as session:
            agent = _agent(session, tenant_id, agent_id)
            visible_ids = visible_version_ids(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
            snapshot = session.scalar(
                select(AgentConfigSnapshot).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                    AgentConfigSnapshot.id == version_id,
                    AgentConfigSnapshot.id.in_(select(visible_ids.c.current_snapshot_id)),
                )
            )
            if snapshot is None:
                raise AgentVersionUnavailableError
            draft = session.scalar(
                select(AgentConfigDraft)
                .where(
                    AgentConfigDraft.tenant_id == tenant_id,
                    AgentConfigDraft.agent_id == agent_id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                    AgentConfigDraft.account_id.is_(None),
                )
                .limit(1)
            )
            config = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
            if draft is None:
                draft = AgentConfigDraft(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    account_id=None,
                    draft_owner_key="",
                    created_by=account_id,
                    home_snapshot_id=snapshot.home_snapshot_id,
                    config_snapshot=config,
                )
                session.add(draft)
            else:
                draft.config_snapshot = config
            draft.base_snapshot_id = snapshot.id
            draft.home_snapshot_id = snapshot.home_snapshot_id
            draft.updated_by = account_id
            agent.active_config_is_published = snapshot.id == agent.active_config_snapshot_id
            agent.updated_by = account_id
            session.flush()
            return AgentVersionRestored(
                result="success",
                active_config_snapshot_id=agent.active_config_snapshot_id or snapshot.id,
                draft_config_id=draft.id,
                restored_version_id=snapshot.id,
            )
