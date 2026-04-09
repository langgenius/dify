from blinker import signal

# sender: message, kwargs: conversation
message_was_created = signal("message-was-created")
