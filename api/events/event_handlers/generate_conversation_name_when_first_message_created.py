from core.generator.llm_generator import LLMGenerator
from events.message_event import message_was_created
from extensions.ext_database import db


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    conversation = kwargs.get('conversation')
    is_first_message = kwargs.get('is_first_message')
    auto_generate_name = kwargs.get('auto_generate_name', True)

    if auto_generate_name and is_first_message:
        if conversation.mode == 'chat':
            app_model = conversation.app
            if not app_model:
                return

            # generate conversation name
            try:
                name = LLMGenerator.generate_conversation_name(app_model.tenant_id, message.query)
                conversation.name = name
            except:
                pass

            db.session.commit()
