from constants import UUID_NIL


def extract_thread_messages(messages: list[dict]) -> list[dict]:
    thread_messages = []
    next_message = None

    for message in messages:
        if not message.parent_message_id:
            # If the message is regenerated and does not have a parent message, it is the start of a new thread
            thread_messages.append(message)
            break

        if not next_message:
            thread_messages.append(message)
            next_message = message.parent_message_id
        else:
            if message.id == next_message or next_message == UUID_NIL:
                thread_messages.append(message)
                next_message = message.parent_message_id

    return thread_messages