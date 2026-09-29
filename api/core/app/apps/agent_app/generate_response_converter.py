"""Response converter for the Agent App type.

The Agent App streams the same chatbot response shape as the chat / agent-chat
app types, so it reuses that converter wholesale; kept as a distinct subclass so
the app type owns its converter and can diverge later.
"""

from core.app.apps.agent_chat.generate_response_converter import AgentChatAppGenerateResponseConverter


class AgentAppGenerateResponseConverter(AgentChatAppGenerateResponseConverter):
    pass


__all__ = ["AgentAppGenerateResponseConverter"]
