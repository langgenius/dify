"""Share the legacy conversation-title runtime in an isolated provider scope."""

from flask import current_app

from services.conversation_service import ConversationService


def generate_conversation_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
    """Release provider sessions without removing the surrounding request's session."""
    with current_app.app_context():
        return ConversationService.generate_name(
            tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id, query=query, app_mode=app_mode
        )
