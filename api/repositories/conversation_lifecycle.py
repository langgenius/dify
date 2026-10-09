"""Shared conversation lifecycle mutations within a caller-owned transaction."""

import logging

from sqlalchemy.orm import Session

from core.agent.workspace import AgentWorkspaceNotFoundError, WorkspaceOwnerScope
from models.agent import AgentWorkspaceOwnerType
from models.model import App, Conversation
from repositories.agent_workspace_repository import AgentWorkspaceRepository

logger = logging.getLogger(__name__)


def retire_conversation(*, app_model: App, conversation: Conversation, session: Session) -> tuple[str, ...]:
    """Retire a conversation and all its workspaces in the caller's transaction.

    The caller must validate conversation ownership before calling, commit
    all lifecycle changes together, then enqueue cleanup after that commit.
    This function neither commits nor dispatches background tasks.
    """
    workspaces = AgentWorkspaceRepository(session=session)
    binding_id = conversation.agent_workspace_binding_id
    if binding_id is not None:
        owner_scope = WorkspaceOwnerScope(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=conversation.id,
        )
        binding = workspaces.get_active_binding(
            tenant_id=app_model.tenant_id,
            binding_id=binding_id,
            expected_owner_scope=owner_scope,
        )
        if binding is None:
            raise AgentWorkspaceNotFoundError("Conversation participant Binding is unavailable")

    logger.info(
        "Initiating conversation deletion for app_name %s, conversation_id: %s",
        app_model.name,
        conversation.id,
    )
    retired_workspace_ids = workspaces.retire_all_for_conversation(
        tenant_id=app_model.tenant_id,
        app_id=app_model.id,
        conversation_id=conversation.id,
    )
    conversation.is_deleted = True
    return tuple(retired_workspace_ids)
