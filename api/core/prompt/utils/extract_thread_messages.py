from collections.abc import Sequence

from constants import UUID_NIL
from models import Message


def extract_thread_messages(messages: Sequence[Message]):
    thread_messages: list[Message] = []
    next_message = None

    for message in messages:
        if not next_message:
            thread_messages.append(message)
            if not message.parent_message_id:
                # If the message is regenerated and does not have a parent message, it is the start of a new thread
                break
            next_message = message.parent_message_id
        else:
            if next_message in {message.id, UUID_NIL}:
                thread_messages.append(message)
                if not message.parent_message_id:
                    # Same "start of a new thread" case, but for the message currently being tracked
                    break
                next_message = message.parent_message_id

    return thread_messages
