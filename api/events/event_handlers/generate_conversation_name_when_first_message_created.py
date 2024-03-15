from core.llm_generator.llm_generator import LLMGenerator
from events.message_event import message_was_created
from extensions.ext_database import db
from models.model import AppMode


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    conversation = kwargs.get('conversation')
    is_first_message = kwargs.get('is_first_message')
    extras = kwargs.get('extras', {})

    auto_generate_conversation_name = True
    if extras:
        auto_generate_conversation_name = extras.get('auto_generate_conversation_name', True)

    if auto_generate_conversation_name and is_first_message:
        if conversation.mode != AppMode.COMPLETION.value:
            app_model = conversation.app
            if not app_model:
                return

            # generate conversation name
            try:
                name = LLMGenerator.generate_conversation_name(app_model.tenant_id, message.query)
                conversation.name = name
            except:
                pass
                
            db.session.merge(conversation)
            db.session.commit()
