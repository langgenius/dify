"""Shared conversation lifecycle mutations within a caller-owned transaction."""

import logging

from sqlalchemy.orm import Session

from models.agent import AgentWorkspaceOwnerType
from models.model import App, Conversation
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService, WorkspaceOwnerScope

logger = logging.getLogger(__name__)


def retire_conversation(*, app_model: App, conversation: Conversation, session: Session) -> str | None:
    """Retire a conversation and its participant in the caller's transaction.

    The caller must validate conversation ownership before calling, commit
    all lifecycle changes together, then enqueue cleanup after that commit.
    This function neither commits nor dispatches background tasks.
    """
    binding_id = conversation.agent_workspace_binding_id
    retired_binding_id: str | None = None
    # Reuse the existing Workspace lifecycle owner. These two methods only
    # read and mutate the supplied session; they do not perform external I/O.
    if binding_id is not None:
        owner_scope = WorkspaceOwnerScope(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=conversation.id,
        )
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
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
    if binding_id is not None:
        retired_binding_id = AgentWorkspaceService.retire_binding(
            session=session,
            tenant_id=app_model.tenant_id,
            binding_id=binding_id,
        )
        if retired_binding_id is None:
            raise AgentWorkspaceNotFoundError("Conversation participant Binding is unavailable")
    conversation.is_deleted = True
    return retired_binding_id
