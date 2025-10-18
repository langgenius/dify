from core.message.repositories.factory import get_message_repository
from core.prompt.utils.extract_thread_messages import extract_thread_messages


def get_thread_messages_length(conversation_id: str) -> int:
    """
    Get the number of thread messages based on the parent message id.
    """
    message_repository = get_message_repository()
    messages = message_repository.get_conversation_messages(conversation_id=conversation_id)

    # Extract thread messages
    thread_messages = extract_thread_messages(messages)

    # Exclude the newly created message with an empty answer
    if thread_messages and not thread_messages[0].answer:
        thread_messages.pop(0)

    return len(thread_messages)
