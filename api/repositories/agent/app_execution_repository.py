"""Short Agent App configuration transactions, shared with Composer's config persistence."""

from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.agent.workspace import WorkspaceOwnerScope
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import Conversation
from repositories.agent.config_repository import AgentConfigRepository
from repositories.agent_workspace_repository import AgentWorkspaceRepository
from services.app.generation.agent_config import AgentAppConfiguration
from services.app.generation.errors import AgentAppGeneratorError, AgentAppNotPublishedError


class AgentAppExecutionRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @staticmethod
    def _agent(session: Session, *, tenant_id: str, app_id: str, agent_id: str | None = None) -> Agent:
        query = select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.status == AgentStatus.ACTIVE,
            or_(
                and_(
                    Agent.app_id == app_id, Agent.scope == AgentScope.ROSTER, Agent.source.in_(APP_BACKED_AGENT_SOURCES)
                ),
                Agent.backing_app_id == app_id,
            ),
        )
        if agent_id is not None:
            query = query.where(Agent.id == agent_id)
        agent = session.scalar(query.order_by(Agent.created_at.desc()).limit(1))
        if agent is None:
            raise AgentAppGeneratorError("Agent App has no bound Agent")
        return agent

    @staticmethod
    def _configuration(agent: Agent, version: AgentConfigSnapshot | AgentConfigDraft) -> AgentAppConfiguration:
        return AgentAppConfiguration(
            agent_id=agent.id,
            version_id=version.id,
            version_kind=("build_draft" if version.draft_type == AgentConfigDraftType.DEBUG_BUILD else "draft")
            if isinstance(version, AgentConfigDraft)
            else "snapshot",
            soul=AgentSoulConfig.model_validate(version.config_snapshot_dict),
            home_snapshot_id=version.home_snapshot_id,
        )

    def resolve(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str | None,
        debug: bool,
        draft_type: str | None,
        conversation_id: str | None,
        form_id: str | None = None,
    ) -> AgentAppConfiguration:
        with self._sessions.begin() as session:
            agent = self._agent(session, tenant_id=tenant_id, app_id=app_id)
            conversation = (
                session.scalar(
                    select(Conversation).where(
                        Conversation.id == conversation_id,
                        Conversation.app_id == app_id,
                        Conversation.is_deleted.is_(False),
                    )
                )
                if conversation_id is not None
                else None
            )
            if conversation_id is not None and conversation is None:
                raise AgentAppGeneratorError("Conversation is unavailable")
            if debug:
                draft_id = None
                if form_id is not None and account_id is not None:
                    resumed_draft = session.scalar(
                        select(AgentConfigDraft)
                        .join(
                            AgentWorkspaceBinding,
                            AgentWorkspaceBinding.id == AgentConfigDraft.agent_workspace_binding_id,
                        )
                        .where(
                            AgentConfigDraft.tenant_id == tenant_id,
                            AgentConfigDraft.agent_id == agent.id,
                            AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                            AgentConfigDraft.account_id == account_id,
                            AgentWorkspaceBinding.tenant_id == tenant_id,
                            AgentWorkspaceBinding.app_id == app_id,
                            AgentWorkspaceBinding.agent_id == agent.id,
                            AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                            AgentWorkspaceBinding.pending_form_id == form_id,
                        )
                    )
                    if resumed_draft is not None:
                        # The candidate query inner-joins this exact pointer.
                        assert resumed_draft.agent_workspace_binding_id is not None
                        binding = AgentWorkspaceRepository(session=session).get_active_binding(
                            tenant_id=tenant_id,
                            binding_id=resumed_draft.agent_workspace_binding_id,
                            expected_owner_scope=WorkspaceOwnerScope(
                                tenant_id, app_id, AgentWorkspaceOwnerType.BUILD_DRAFT, resumed_draft.id
                            ),
                        )
                        if binding is None or binding.agent_id != agent.id:
                            raise AgentAppGeneratorError("Build participant Binding is unavailable")
                        AgentWorkspaceRepository.validate_binding_generation(
                            binding,
                            base_home_snapshot_id=resumed_draft.home_snapshot_id,
                            agent_config_version_id=resumed_draft.id,
                            agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                        )
                        draft_id = resumed_draft.id
                    draft_type = AgentConfigDraftType.DEBUG_BUILD if draft_id else AgentConfigDraftType.DRAFT
                if draft_type == AgentConfigDraftType.DEBUG_BUILD:
                    if not account_id:
                        raise AgentAppGeneratorError("Build draft requires an account user")
                    draft = AgentConfigRepository.get_draft(
                        session=session,
                        tenant_id=tenant_id,
                        agent_id=agent.id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                        account_id=account_id,
                        draft_id=draft_id,
                    )
                    if draft is None:
                        raise AgentAppGeneratorError("Agent build draft not found")
                else:
                    draft = AgentConfigRepository.normal_draft(
                        session=session,
                        tenant_id=tenant_id,
                        agent=agent,
                        created_by=agent.updated_by or agent.created_by,
                    )
                return self._configuration(agent, draft)
            if not agent_has_workflow_callable_active_snapshot(session=session, agent=agent):
                raise AgentAppNotPublishedError("Agent has not been published")
            binding = None
            if conversation is not None and conversation.agent_workspace_binding_id is not None:
                binding = AgentWorkspaceRepository(session=session).get_active_binding(
                    tenant_id=tenant_id,
                    binding_id=conversation.agent_workspace_binding_id,
                    expected_owner_scope=WorkspaceOwnerScope(
                        tenant_id, app_id, AgentWorkspaceOwnerType.CONVERSATION, conversation.id
                    ),
                )
                if binding is None or binding.agent_id != agent.id:
                    raise AgentAppGeneratorError("Conversation participant Binding is unavailable")
            snapshot = AgentConfigRepository.get_snapshot(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent.id,
                version_id=binding.agent_config_version_id if binding is not None else agent.active_config_snapshot_id,
            )
            if snapshot is None:
                raise AgentAppGeneratorError("Agent published version not found")
            if binding is not None:
                AgentWorkspaceRepository.validate_binding_generation(
                    binding,
                    base_home_snapshot_id=snapshot.home_snapshot_id,
                    agent_config_version_id=snapshot.id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
            return self._configuration(agent, snapshot)

    def version(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        version_id: str,
        version_kind: Literal["snapshot", "draft", "build_draft"],
        account_id: str | None,
    ) -> AgentAppConfiguration:
        """Reload the requested generation under the same complete app and actor ownership."""
        with self._sessions() as session:
            agent = self._agent(session, tenant_id=tenant_id, app_id=app_id, agent_id=agent_id)
            if version_kind == "snapshot":
                version = AgentConfigRepository.get_snapshot(
                    session=session, tenant_id=tenant_id, agent_id=agent_id, version_id=version_id
                )
            else:
                if version_kind == "build_draft" and account_id is None:
                    raise AgentAppGeneratorError("Build draft requires an account user")
                version = AgentConfigRepository.get_draft(
                    session=session,
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    draft_id=version_id,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD
                    if version_kind == "build_draft"
                    else AgentConfigDraftType.DRAFT,
                    account_id=account_id if version_kind == "build_draft" else None,
                )
            if version is None:
                raise AgentAppGeneratorError("Agent config version not found")
            return self._configuration(agent, version)
