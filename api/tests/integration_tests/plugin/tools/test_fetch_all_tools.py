from core.plugin.impl.tool import PluginToolManager

pytest_plugins = ("tests.integration_tests.plugin.__mock.http",)


def test_fetch_all_plugin_tools(setup_http_mock):
    manager = PluginToolManager()
    tools = manager.fetch_tool_providers(tenant_id="test-tenant")
    assert len(tools) >= 1
