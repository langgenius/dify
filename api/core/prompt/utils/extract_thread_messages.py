def extract_thread_messages(messages: list[dict]) -> list[dict]:
    thread_messages = []
    next_message = None

    for message in messages:
        if message.is_regenerated and not message.parent_message_id:
            # If the message is regenerated and does not have a parent message, it is the start of a new thread
            thread_messages.append(message)
            break

        if not next_message:
            thread_messages.append(message)
            if message.parent_message_id:
                next_message = message.parent_message_id
        else:
            if message.id == next_message:
                thread_messages.append(message)
                next_message = message.parent_message_id

    return thread_messages