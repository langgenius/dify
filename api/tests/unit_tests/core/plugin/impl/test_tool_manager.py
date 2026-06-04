from types import SimpleNamespace

from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager


def _tool_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            tools=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginToolManager:
    def test_fetch_tool_providers(self, mocker: MockerFixture):
        manager = PluginToolManager()
        provider = _tool_provider("remote")
        mocker.patch("core.plugin.impl.tool.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "tools": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}],
                        }
                    }
                ]
            }
            transformed = transformer(payload)
            assert transformed["data"][0]["declaration"]["tools"][0]["output_schema"] == {"resolved": True}
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_tool_providers("tenant-1")

        assert request_mock.call_count == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.tools[0].identity.provider == "org/plugin/remote"

    def test_fetch_tool_provider(self, mocker: MockerFixture):
        manager = PluginToolManager()
        provider = _tool_provider("provider")
        mocker.patch("core.plugin.impl.tool.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": {
                    "declaration": {"tools": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}]}
                }
            }
            transformed = transformer(payload)
            assert transformed["data"]["declaration"]["tools"][0]["output_schema"] == {"resolved": True}
            return provider

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_tool_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.tools[0].identity.provider == "org/plugin/provider"

    def test_invoke_merges_chunks(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(
            manager, "_request_with_plugin_daemon_response_stream", return_value=iter(["chunk"])
        )
        merge_mock = mocker.patch("core.plugin.impl.tool.merge_blob_chunks", return_value=["merged"])

        result = manager.invoke(
            tenant_id="tenant-1",
            user_id="user-1",
            tool_provider="org/plugin/provider",
            tool_name="search",
            credentials={"api_key": "k"},
            credential_type=CredentialType.API_KEY,
            tool_parameters={"q": "python"},
            conversation_id="conv-1",
            app_id="app-1",
            message_id="msg-1",
        )

        assert result == ["merged"]
        assert merge_mock.call_count == 1
        assert stream_mock.call_args.kwargs["headers"]["X-Plugin-ID"] == "org/plugin"

    def test_validate_credentials_paths(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")

        stream_mock.return_value = iter([SimpleNamespace(result=True)])
        assert manager.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is True

        stream_mock.return_value = iter([])
        assert manager.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is False

        stream_mock.return_value = iter([SimpleNamespace(result=True)])
        assert manager.validate_datasource_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is True

        stream_mock.return_value = iter([])
        assert manager.validate_datasource_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is False

    def test_get_runtime_parameters_paths(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")

        stream_mock.return_value = iter([SimpleNamespace(parameters=[{"name": "p"}])])
        params = manager.get_runtime_parameters("tenant-1", "user-1", "org/plugin/provider", {}, "search")
        assert params == [{"name": "p"}]

        stream_mock.return_value = iter([])
        params = manager.get_runtime_parameters("tenant-1", "user-1", "org/plugin/provider", {}, "search")
        assert params == []
