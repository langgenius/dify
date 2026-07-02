import logging

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from core.memory.engram import build_engram_memory
from events.message_event import message_was_created
from models.model import Message

logger = logging.getLogger(__name__)


@message_was_created.connect
def handle(sender: Message, **kwargs):
    """
    Write the completed conversation turn to the app's Weaviate Engram long-term memory.

    Runs on the post-generation ``message_was_created`` signal, where the user query and final
    assistant answer are both available. Engram is configured per app (per bot): the credentials
    and enable flag are read from the app config, so only bots that opt in write memories. The write
    is fire-and-forget (the wrapper swallows and logs errors), so it never affects message persistence.
    """
    message = sender
    application_generate_entity = kwargs.get("application_generate_entity")
    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    app_config = application_generate_entity.app_config
    engram_config = getattr(app_config, "engram", None)

    user_id = application_generate_entity.user_id
    if not user_id or not message.answer:
        return

    memory = build_engram_memory(
        user_id=user_id,
        tenant_id=app_config.tenant_id,
        conversation_id=message.conversation_id,
        enabled=bool(engram_config and engram_config.enabled),
        api_key_encrypted=engram_config.api_key if engram_config else None,
        endpoint=engram_config.endpoint if engram_config else None,
    )
    if memory is None:
        return

    conversation_messages: list[dict[str, str]] = []
    if message.query:
        conversation_messages.append({"role": "user", "content": message.query})
    conversation_messages.append({"role": "assistant", "content": message.answer})

    memory.store(conversation_messages)
