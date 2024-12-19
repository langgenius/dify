from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from models.model import Message


def get_thread_messages_length(conversation_id: str) -> int:
    """
    Get the number of thread messages based on the parent message id.
    """
    # Fetch all messages related to the conversation
    query = (
        db.session.query(
            Message.id,
            Message.parent_message_id,
            Message.answer,
        )
        .filter(
            Message.conversation_id == conversation_id,
        )
        .order_by(Message.created_at.desc())
    )

    messages = query.all()

    # Extract thread messages
    thread_messages = extract_thread_messages(messages)

    # Exclude the newly created message with an empty answer
    if thread_messages and not thread_messages[0].answer:
        thread_messages.pop(0)

    return len(thread_messages)
