class MemorySyncTimeoutError(Exception):
    def __init__(self, app_id: str, conversation_id: str):
        self.app_id = app_id
        self.conversation_id = conversation_id
        self.message = "Memory synchronization timeout after 50 seconds"
        super().__init__(self.message)
