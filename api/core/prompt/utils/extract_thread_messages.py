from collections.abc import Sequence

from constants import UUID_NIL
from models import Message


def extract_thread_messages(messages: Sequence[Message], active_message_id: str | None = None):
    """
    Extract the visible message thread from newest-to-oldest messages.

    When active_message_id is provided, branch traversal starts from that message so regenerated sibling answers newer
    than the active answer do not leak into memory.
    """
    thread_messages: list[Message] = []
    next_message = None
    active_message_found = active_message_id is None

    for message in messages:
        if not active_message_found:
            if message.id != active_message_id:
                continue
            active_message_found = True

        if not message.parent_message_id:
            # If the message is regenerated and does not have a parent message, it is the start of a new thread
            thread_messages.append(message)
            break

        if not next_message:
            thread_messages.append(message)
            if active_message_id and message.parent_message_id == UUID_NIL:
                break
            next_message = message.parent_message_id
        else:
            if message.id == next_message or (not active_message_id and next_message == UUID_NIL):
                thread_messages.append(message)
                if active_message_id and message.parent_message_id == UUID_NIL:
                    break
                next_message = message.parent_message_id

    if active_message_id and not thread_messages:
        return extract_thread_messages(messages)

    return thread_messages
