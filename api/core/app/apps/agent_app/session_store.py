"""Persist and resolve the exact participant owned by an Agent App caller."""

from __future__ import annotations

from dataclasses import dataclass

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, Conversation
from services.agent.workspace_service import (
    AgentWorkspaceNotFoundError,
    AgentWorkspaceService,
    WorkspaceOwnerScope,
)


@dataclass(frozen=True, slots=True)
class AgentAppSessionScope:
    tenant_id: str
    app_id: str
    conversation_id: str
    agent_id: str
    agent_config_snapshot_id: str
    home_snapshot_id: str
    agent_config_version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT
    build_draft_id: str | None = None

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        owner_type = (
            AgentWorkspaceOwnerType.BUILD_DRAFT if self.build_draft_id else AgentWorkspaceOwnerType.CONVERSATION
        )
        return WorkspaceOwnerScope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            owner_type=owner_type,
            owner_id=self.build_draft_id or self.conversation_id,
        )


@dataclass(frozen=True, slots=True)
class StoredAgentAppSession:
    scope: AgentAppSessionScope
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    session_snapshot: CompositorSessionSnapshot | None
    pending_form_id: str | None = None
    pending_tool_call_id: str | None = None


class AgentAppWorkspaceStore:
    """Resolve Agent App sessions through a caller-owned Binding pointer."""

    def load_or_create(self, scope: AgentAppSessionScope) -> StoredAgentAppSession:
        with session_factory.create_session() as session:
            caller = self._load_caller(session=session, scope=scope)
            binding_id = caller.agent_workspace_binding_id
            if binding_id is None:
                binding = AgentWorkspaceService.create_binding(
                    session=session,
                    scope=scope.workspace_owner,
                    agent_id=scope.agent_id,
                    base_home_snapshot_id=scope.home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=scope.agent_config_version_kind,
                )
                caller.agent_workspace_binding_id = binding.id
                session.commit()
            else:
                binding = self._get_binding(session=session, scope=scope, binding_id=binding_id)
            return self._stored(scope, binding)

    @staticmethod
    def _load_caller(*, session: Session, scope: AgentAppSessionScope) -> Conversation | AgentConfigDraft:
        if scope.build_draft_id is not None:
            if scope.agent_config_version_kind != AgentConfigVersionKind.BUILD_DRAFT:
                raise AgentWorkspaceNotFoundError("Build Draft caller requires build_draft generation")
            draft = session.scalar(
                select(AgentConfigDraft).where(
                    AgentConfigDraft.id == scope.build_draft_id,
                    AgentConfigDraft.tenant_id == scope.tenant_id,
                    AgentConfigDraft.agent_id == scope.agent_id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                )
            )
            if draft is None:
                raise AgentWorkspaceNotFoundError("Build Draft caller is unavailable")
            return draft
        if scope.agent_config_version_kind == AgentConfigVersionKind.BUILD_DRAFT:
            raise AgentWorkspaceNotFoundError("Build Draft caller ID is required")
        conversation = session.scalar(
            select(Conversation)
            .join(App, App.id == Conversation.app_id)
            .where(
                App.tenant_id == scope.tenant_id,
                Conversation.id == scope.conversation_id,
                Conversation.app_id == scope.app_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation is None:
            raise AgentWorkspaceNotFoundError("Conversation caller is unavailable")
        return conversation

    @staticmethod
    def _get_binding(
        *,
        session: Session,
        scope: AgentAppSessionScope,
        binding_id: str,
    ) -> AgentWorkspaceBinding:
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            expected_owner_scope=scope.workspace_owner,
        )
        if binding is None or binding.agent_id != scope.agent_id:
            raise AgentWorkspaceNotFoundError("Caller participant Binding is unavailable")
        AgentWorkspaceService.validate_binding_generation(
            binding,
            base_home_snapshot_id=scope.home_snapshot_id,
            agent_config_version_id=scope.agent_config_snapshot_id,
            agent_config_version_kind=scope.agent_config_version_kind,
        )
        return binding

    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: CompositorSessionSnapshot | None,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        if snapshot is None:
            return
        AgentWorkspaceService.save_binding_session_snapshot(
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            session_snapshot=snapshot.model_dump_json(),
            pending_form_id=pending_form_id,
            pending_tool_call_id=pending_tool_call_id,
        )

    @staticmethod
    def _stored(scope: AgentAppSessionScope, binding: AgentWorkspaceBinding) -> StoredAgentAppSession:
        snapshot = (
            CompositorSessionSnapshot.model_validate_json(binding.session_snapshot)
            if binding.session_snapshot
            else None
        )
        return StoredAgentAppSession(
            scope=scope,
            binding_id=binding.id,
            workspace_id=binding.workspace_id,
            backend_binding_ref=binding.backend_binding_ref,
            session_snapshot=snapshot,
            pending_form_id=binding.pending_form_id,
            pending_tool_call_id=binding.pending_tool_call_id,
        )


__all__ = ["AgentAppSessionScope", "AgentAppWorkspaceStore", "StoredAgentAppSession"]
