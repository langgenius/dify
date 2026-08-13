from core.plugin.entities.plugin import PluginCategory, PluginDeclaration, PluginEntity
from core.plugin.entities.plugin_daemon import PluginListResponse, PluginListWithoutTotalResponse
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.plugin.impl.plugin import PluginInstaller


def _plugin_entity(plugin_id: str, category: PluginCategory) -> PluginEntity:
    return PluginEntity.model_construct(
        plugin_id=plugin_id,
        declaration=PluginDeclaration.model_construct(category=category),
    )


class TestPluginInstaller:
    def test_list_plugins_by_category_falls_back_to_management_list_when_category_route_missing(self, mocker):
        client = PluginInstaller()
        model_plugin = _plugin_entity("model-plugin", PluginCategory.Model)
        tool_plugin = _plugin_entity("tool-plugin", PluginCategory.Tool)
        request_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response",
            side_effect=[
                PluginDaemonClientSideError("Client error '404 Not Found' for url"),
                PluginListResponse.model_construct(list=[model_plugin, tool_plugin], total=2),
            ],
        )

        result = client.list_plugins_by_category("tenant-1", PluginCategory.Model, page=1, page_size=100)

        assert result.list == [model_plugin]
        assert result.has_more is False
        assert request_mock.call_args_list[0].args[:3] == (
            "GET",
            "plugin/tenant-1/management/model/list",
            PluginListWithoutTotalResponse,
        )
        assert request_mock.call_args_list[0].kwargs["params"] == {
            "page": 1,
            "page_size": 100,
            "response_type": "paged",
            "query": "",
            "tags": [],
            "language": "en_US",
        }
        assert request_mock.call_args_list[1].args[:3] == (
            "GET",
            "plugin/tenant-1/management/list",
            PluginListResponse,
        )
