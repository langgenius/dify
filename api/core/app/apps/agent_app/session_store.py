"""Conversation/build Workspace Binding store for Agent App execution."""

from __future__ import annotations

from dataclasses import dataclass

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.agent import (
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope


@dataclass(frozen=True, slots=True)
class AgentAppSessionScope:
    tenant_id: str
    app_id: str
    conversation_id: str
    agent_id: str
    agent_config_snapshot_id: str
    home_snapshot_id: str
    agent_config_version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        owner_type = (
            AgentWorkspaceOwnerType.BUILD_DRAFT
            if self.agent_config_version_kind == AgentConfigVersionKind.BUILD_DRAFT
            else AgentWorkspaceOwnerType.CONVERSATION
        )
        return WorkspaceOwnerScope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            owner_type=owner_type,
            owner_id=self.conversation_id,
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
    """Resolve Agent App sessions through persistent Workspace Bindings."""

    def resolve_or_create(self, scope: AgentAppSessionScope) -> StoredAgentAppSession:
        binding = AgentWorkspaceService.create_or_resolve_binding(
            scope=scope.workspace_owner,
            agent_id=scope.agent_id,
            base_home_snapshot_id=scope.home_snapshot_id,
            agent_config_version_id=scope.agent_config_snapshot_id,
            agent_config_version_kind=scope.agent_config_version_kind,
        )
        return self._stored(scope, binding)

    def load_active_session(self, scope: AgentAppSessionScope) -> StoredAgentAppSession | None:
        with session_factory.create_session() as session:
            binding = AgentWorkspaceService.resolve_active_binding(
                session=session,
                scope=scope.workspace_owner,
                agent_id=scope.agent_id,
            )
            return self._stored(scope, binding) if binding is not None else None

    def load_active_session_for_conversation(
        self,
        *,
        tenant_id: str,
        app_id: str,
        conversation_id: str,
    ) -> StoredAgentAppSession | None:
        with session_factory.create_session() as session:
            debug_agent_id = session.scalar(
                select(AgentDebugConversation.agent_id)
                .where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.app_id == app_id,
                    AgentDebugConversation.conversation_id == conversation_id,
                )
                .order_by(AgentDebugConversation.updated_at.desc(), AgentDebugConversation.id.desc())
                .limit(1)
            )
            binding = AgentWorkspaceService.resolve_latest_active_conversation_binding(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                conversation_id=conversation_id,
                agent_id=debug_agent_id,
                include_build_draft=debug_agent_id is not None,
            )
            if binding is None:
                return None
            scope = AgentAppSessionScope(
                tenant_id=tenant_id,
                app_id=app_id,
                conversation_id=conversation_id,
                agent_id=binding.agent_id,
                agent_config_snapshot_id=binding.agent_config_version_id,
                home_snapshot_id=binding.base_home_snapshot_id,
                agent_config_version_kind=binding.agent_config_version_kind,
            )
            return self._stored(scope, binding)

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
