import logging

from core.generator.llm_generator import LLMGenerator
from events.message_event import message_was_created
from extensions.ext_database import db


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    conversation = kwargs.get('conversation')
    is_first_message = kwargs.get('is_first_message')

    if is_first_message:
        if conversation.mode == 'chat':
            app_model = conversation.app
            if not app_model:
                return

            # generate conversation name
            try:
                name = LLMGenerator.generate_conversation_name(app_model.tenant_id, message.query, message.answer)
                conversation.name = name
            except:
                conversation.name = 'New Chat'
                logging.exception('generate_conversation_name failed')

            db.session.add(conversation)
            db.session.commit()
