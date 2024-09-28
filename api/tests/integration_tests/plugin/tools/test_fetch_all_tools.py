from core.plugin.manager.tool import PluginToolManager
from tests.integration_tests.plugin.__mock.http import setup_http_mock


def test_fetch_all_plugin_tools(setup_http_mock):
    manager = PluginToolManager()
    tools = manager.fetch_tool_providers(tenant_id="test-tenant")
    assert len(tools) >= 1
