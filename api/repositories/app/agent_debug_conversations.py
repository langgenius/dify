"""Editor conversation persistence within a caller-owned transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import AgentConfigDraftType, AgentDebugConversation
from models.enums import ConversationFromSource, ConversationStatus, InvokeFrom
from models.model import AppMode, Conversation


def create_agent_debug_conversation(session: Session, *, app_id: str, account_id: str) -> str:
    """Flush a new editor conversation for the resolved App in the caller's transaction."""

    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        mode=AppMode.AGENT,
        name="Agent Debugging Conversation",
        _inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status=ConversationStatus.NORMAL,
        invoke_from=InvokeFrom.DEBUGGER,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id=account_id,
    )
    session.add(conversation)
    session.flush()
    return conversation.id


def get_or_create_agent_debug_conversation(
    session: Session,
    *,
    tenant_id: str,
    agent_id: str,
    backing_app_id: str,
    account_id: str,
    draft_type: AgentConfigDraftType,
) -> str:
    """Reuse a valid editor conversation or flush a replacement for the resolved App."""
    mapping = session.scalar(
        select(AgentDebugConversation).where(
            AgentDebugConversation.tenant_id == tenant_id,
            AgentDebugConversation.agent_id == agent_id,
            AgentDebugConversation.account_id == account_id,
            AgentDebugConversation.draft_type == draft_type,
        )
    )
    if mapping is not None:
        conversation_id = session.scalar(
            select(Conversation.id).where(
                Conversation.id == mapping.conversation_id,
                Conversation.app_id == backing_app_id,
                Conversation.from_source == ConversationFromSource.CONSOLE,
                Conversation.from_account_id == account_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation_id:
            return conversation_id

        mapping.conversation_id = create_agent_debug_conversation(
            session,
            app_id=backing_app_id,
            account_id=account_id,
        )
        mapping.app_id = backing_app_id
        session.flush()
        return mapping.conversation_id

    conversation_id = create_agent_debug_conversation(
        session,
        app_id=backing_app_id,
        account_id=account_id,
    )
    session.add(
        AgentDebugConversation(
            tenant_id=tenant_id,
            agent_id=agent_id,
            app_id=backing_app_id,
            account_id=account_id,
            draft_type=draft_type,
            conversation_id=conversation_id,
        )
    )
    session.flush()
    return conversation_id
