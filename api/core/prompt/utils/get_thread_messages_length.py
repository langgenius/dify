from sqlalchemy import select
from sqlalchemy.orm import Session

from core.prompt.utils.extract_thread_messages import extract_thread_messages
from models.model import Message


def get_thread_messages_length(conversation_id: str, *, session: Session) -> int:
    """
    Get the number of thread messages based on the parent message id.
    """
    # Fetch all messages related to the conversation
    stmt = select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.desc())

    messages = session.scalars(stmt).all()

    # Extract thread messages
    thread_messages = extract_thread_messages(messages)

    # Exclude only a freshly created placeholder message: one with an empty
    # answer AND no produced tokens yet. An in-progress message whose answer is
    # still streaming (empty answer but answer_tokens > 0) must be kept.
    if thread_messages and not thread_messages[0].answer and thread_messages[0].answer_tokens == 0:
        thread_messages.pop(0)

    return len(thread_messages)
