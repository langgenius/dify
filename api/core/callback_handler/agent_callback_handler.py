from core.application_queue_manager import ApplicationQueueManager


class AgentCallbackHandler:
    """Callback handler for agent."""

    def __init__(self, queue_manager: ApplicationQueueManager,
                 message_id: str,
                 user_id: str) -> None:
        self._queue_manager = queue_manager
        self._message_id = message_id
        self._user_id = user_id
