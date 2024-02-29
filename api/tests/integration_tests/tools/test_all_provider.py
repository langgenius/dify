from core.tools.tool_manager import ToolManager


def test_tool_providers():
    """
    Test that all tool providers can be loaded
    """
    providers = ToolManager.list_builtin_providers()
    for provider in providers:
        provider.get_tools()
