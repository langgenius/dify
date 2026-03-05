from blinker import signal

# sender: MessageFeedback, kwargs: tenant_id
feedback_was_created = signal("feedback-was-created")
