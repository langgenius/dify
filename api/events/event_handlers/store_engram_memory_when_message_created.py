import logging

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from core.memory.engram import EngramMemory, is_engram_enabled
from events.message_event import message_was_created
from models.model import Message

logger = logging.getLogger(__name__)


@message_was_created.connect
def handle(sender: Message, **kwargs):
    """
    Write the completed conversation turn to Weaviate Engram long-term memory.

    Runs on the post-generation ``message_was_created`` signal, where the user query and
    final assistant answer are both available. The Engram write is fire-and-forget (the
    wrapper swallows and logs errors), so it never affects message persistence.
    """
    if not is_engram_enabled():
        return

    message = sender
    application_generate_entity = kwargs.get("application_generate_entity")
    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    user_id = application_generate_entity.user_id
    if not user_id or not message.answer:
        return

    conversation_messages: list[dict[str, str]] = []
    if message.query:
        conversation_messages.append({"role": "user", "content": message.query})
    conversation_messages.append({"role": "assistant", "content": message.answer})

    EngramMemory(user_id=user_id, conversation_id=message.conversation_id).store(conversation_messages)
