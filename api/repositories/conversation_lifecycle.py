"""Shared conversation lifecycle mutations within a caller-owned transaction."""

import logging

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from core.agent.workspace import AgentWorkspaceNotFoundError, WorkspaceOwnerScope
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.enums import ConversationFromSource, InvokeFrom
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


def retire_superseded_debug_conversations(
    *,
    session: Session,
    tenant_id: str,
    app_id: str,
    account_id: str,
    current_conversation_id: str,
) -> tuple[str, ...]:
    """Retire ACTIVE workspaces of the editor's superseded debug conversations.

    Console debug Conversations are hidden from the conversation list and have
    no delete affordance, so creating a new one abandons the previous participant.

    Preconditions: ``current_conversation_id`` is a freshly created debug
    ``Conversation`` of ``app_id`` for ``account_id``. Postconditions: every
    other non-deleted debug ``Conversation`` of that editor owns no ACTIVE
    Workspace; the retired workspace ids are returned. The superseded set is
    restricted to conversations still owning an ACTIVE workspace so the id list
    stays bounded. Neither commits nor dispatches tasks.
    """
    superseded_conversation_ids = tuple(
        session.scalars(
            select(Conversation.id)
            .join(
                AgentWorkspace,
                and_(
                    AgentWorkspace.owner_id == Conversation.id,
                    AgentWorkspace.tenant_id == tenant_id,
                    AgentWorkspace.app_id == app_id,
                    AgentWorkspace.owner_type == AgentWorkspaceOwnerType.CONVERSATION,
                    AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
                ),
            )
            .where(
                Conversation.app_id == app_id,
                Conversation.from_source == ConversationFromSource.CONSOLE,
                Conversation.from_account_id == account_id,
                Conversation.invoke_from == InvokeFrom.DEBUGGER,
                Conversation.is_deleted.is_(False),
                Conversation.id != current_conversation_id,
            )
            .distinct()
        ).all()
    )
    return tuple(
        AgentWorkspaceRepository(session=session).retire_all_for_conversations(
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_ids=superseded_conversation_ids,
        )
    )
