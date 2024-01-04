from core.tools.tool_manager import ToolManager

def test_assistant_providers():
    providers = ToolManager.list_providers()
    for provider in providers:
        provider.get_tools()