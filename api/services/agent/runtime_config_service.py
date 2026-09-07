from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, Conversation


class AgentRuntimeConfigService:
    """Resolve the Agent Soul generation that produced one conversation."""

    def __init__(self, session: Session):
        self._session = session

    def resolve_conversation_soul(
        self,
        *,
        app_model: App,
        conversation: Conversation,
        account_id: str | None,
        use_debug_draft: bool,
    ) -> AgentSoulConfig | None:
        if use_debug_draft and account_id is not None:
            draft_soul = self._resolve_debug_draft_soul(
                app_model=app_model,
                conversation=conversation,
                account_id=account_id,
            )
            if draft_soul is not None:
                return draft_soul

        binding_soul = self._resolve_binding_soul(app_model=app_model, conversation=conversation)
        if binding_soul is not None:
            return binding_soul

        from services.agent.roster_service import AgentRosterService

        return AgentRosterService(self._session).get_published_agent_soul_for_app(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
        )

    def _resolve_debug_draft_soul(
        self,
        *,
        app_model: App,
        conversation: Conversation,
        account_id: str,
    ) -> AgentSoulConfig | None:
        debug_conversation = self._session.scalar(
            select(AgentDebugConversation)
            .where(
                AgentDebugConversation.tenant_id == app_model.tenant_id,
                AgentDebugConversation.app_id == app_model.id,
                AgentDebugConversation.account_id == account_id,
                AgentDebugConversation.conversation_id == conversation.id,
            )
            .limit(1)
        )
        if debug_conversation is None:
            return None

        draft_stmt = select(AgentConfigDraft).where(
            AgentConfigDraft.tenant_id == app_model.tenant_id,
            AgentConfigDraft.agent_id == debug_conversation.agent_id,
            AgentConfigDraft.draft_type == debug_conversation.draft_type,
        )
        if debug_conversation.draft_type == AgentConfigDraftType.DEBUG_BUILD:
            draft_stmt = draft_stmt.where(AgentConfigDraft.account_id == account_id)
        draft = self._session.scalar(draft_stmt.order_by(AgentConfigDraft.updated_at.desc()).limit(1))
        if draft is None:
            return None
        return AgentSoulConfig.model_validate(draft.config_snapshot_dict)

    def _resolve_binding_soul(self, *, app_model: App, conversation: Conversation) -> AgentSoulConfig | None:
        if not conversation.agent_workspace_binding_id:
            return None
        binding = self._session.scalar(
            select(AgentWorkspaceBinding)
            .where(
                AgentWorkspaceBinding.id == conversation.agent_workspace_binding_id,
                AgentWorkspaceBinding.tenant_id == app_model.tenant_id,
                AgentWorkspaceBinding.app_id == app_model.id,
            )
            .limit(1)
        )
        if binding is None:
            return None

        if binding.agent_config_version_kind == AgentConfigVersionKind.SNAPSHOT:
            snapshot = self._session.scalar(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.id == binding.agent_config_version_id,
                    AgentConfigSnapshot.tenant_id == app_model.tenant_id,
                    AgentConfigSnapshot.agent_id == binding.agent_id,
                )
                .limit(1)
            )
            if snapshot is None:
                return None
            return AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)

        draft = self._session.scalar(
            select(AgentConfigDraft)
            .where(
                AgentConfigDraft.id == binding.agent_config_version_id,
                AgentConfigDraft.tenant_id == app_model.tenant_id,
                AgentConfigDraft.agent_id == binding.agent_id,
            )
            .limit(1)
        )
        if draft is None:
            return None
        return AgentSoulConfig.model_validate(draft.config_snapshot_dict)


__all__ = ["AgentRuntimeConfigService"]
