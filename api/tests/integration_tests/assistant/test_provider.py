from core.assistant.assistant_manager import AssistantManager

def test_assistant_provider():
    providers = AssistantManager.list_providers()
    for provider in providers:
        tools = provider.get_tools()
        print(tools)