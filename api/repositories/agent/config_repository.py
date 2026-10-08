"""Shared Agent config and draft persistence in an explicit owning transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot, AgentScope
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import AgentVersionNotFoundError


class AgentConfigRepository:
    @classmethod
    def get_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        draft_type: AgentConfigDraftType,
        account_id: str | None,
        draft_id: str | None = None,
    ) -> AgentConfigDraft | None:
        stmt = select(AgentConfigDraft).where(
            AgentConfigDraft.tenant_id == tenant_id,
            AgentConfigDraft.agent_id == agent_id,
            AgentConfigDraft.draft_type == draft_type,
        )
        if draft_type == AgentConfigDraftType.DEBUG_BUILD:
            stmt = stmt.where(AgentConfigDraft.account_id == account_id)
        else:
            stmt = stmt.where(AgentConfigDraft.account_id.is_(None))
        if draft_id is not None:
            stmt = stmt.where(AgentConfigDraft.id == draft_id)
        return session.scalar(stmt.order_by(AgentConfigDraft.updated_at.desc()).limit(1))

    @classmethod
    def normal_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent: Agent,
        created_by: str | None,
    ) -> AgentConfigDraft:
        """Resolve the normal Draft, rebasing only stale WORKFLOW_ONLY DRAFT rows whose account_id is None.

        Roster and DEBUG_BUILD Drafts are never rebased.
        """
        return cls.get_or_create_draft(
            session=session,
            tenant_id=tenant_id,
            agent=agent,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            created_by=created_by,
        )

    @staticmethod
    def rebase_workflow_draft(
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

    @classmethod
    def get_or_create_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent: Agent,
        draft_type: AgentConfigDraftType,
        account_id: str | None,
        created_by: str | None,
    ) -> AgentConfigDraft:
        # All draft writers lock the parent before checking for an absent draft.
        # Locking a draft query alone cannot serialize concurrent first writes.
        session.scalar(select(Agent.id).where(Agent.tenant_id == tenant_id, Agent.id == agent.id).with_for_update())
        draft = cls.get_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id,
            draft_type=draft_type,
            account_id=account_id,
        )
        if draft is not None:
            if (
                agent.scope == AgentScope.WORKFLOW_ONLY
                and draft_type == AgentConfigDraftType.DRAFT
                and draft.account_id is None
                and agent.active_config_snapshot_id
                and draft.base_snapshot_id != agent.active_config_snapshot_id
            ):
                active_snapshot = cls.get_snapshot(
                    session=session,
                    tenant_id=tenant_id,
                    agent_id=agent.id,
                    version_id=agent.active_config_snapshot_id,
                )
                if active_snapshot is None:
                    raise AgentVersionNotFoundError()
                if cls.rebase_workflow_draft(
                    agent=agent,
                    draft=draft,
                    snapshot=active_snapshot,
                    updated_by=agent.updated_by or agent.created_by,
                ):
                    session.flush()
            return draft
        base_snapshot = cls.get_snapshot(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id,
            version_id=agent.active_config_snapshot_id,
        )
        if base_snapshot is None:
            raise AgentVersionNotFoundError()
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

    @classmethod
    def get_agent(cls, *, session: Session, tenant_id: str, agent_id: str | None) -> Agent | None:
        if not agent_id:
            return None
        return session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))

    @classmethod
    def require_snapshot(
        cls, *, session: Session, tenant_id: str, agent_id: str | None, version_id: str | None
    ) -> AgentConfigSnapshot:
        if not agent_id or not version_id:
            raise AgentVersionNotFoundError()
        version = cls.get_snapshot(session=session, tenant_id=tenant_id, agent_id=agent_id, version_id=version_id)
        if not version:
            raise AgentVersionNotFoundError()
        return version

    @classmethod
    def get_snapshot(
        cls, *, session: Session, tenant_id: str, agent_id: str | None, version_id: str | None
    ) -> AgentConfigSnapshot | None:
        if not agent_id or not version_id:
            return None
        return session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )
