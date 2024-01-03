from core.assistant.entities import AssistantToolProvider

class BasicAssistantToolProvider(AssistantToolProvider):
    def __init__(self, tools):
        self.tools = tools

    def get_tools(self):
        return self.tools