from events.message_event import message_was_created
from tasks.generate_conversation_summary_task import generate_conversation_summary_task


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    conversation = kwargs.get('conversation')
    is_first_message = kwargs.get('is_first_message')

    if not is_first_message and conversation.mode == 'chat' and not conversation.summary:
        history_message_count = conversation.message_count
        if history_message_count >= 5:
            generate_conversation_summary_task.delay(conversation.id)
