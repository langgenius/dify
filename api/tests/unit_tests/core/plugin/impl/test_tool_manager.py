from types import SimpleNamespace

from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager
from tests.unit_tests.core.plugin.impl.test_base_client_impl import _issue_41605_management_tools_list


class _ResponseStub:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


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

    def test_fetch_tool_providers_skips_tool_without_identity(self, mocker: MockerFixture):
        manager = PluginToolManager()
        sibling = _tool_provider("good")
        broken = _tool_provider("broken")
        mocker.patch("core.plugin.impl.tool.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "plugin_id": "org/plugin",
                        "declaration": {
                            "identity": {"name": "good"},
                            "tools": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}],
                        },
                    },
                    {
                        "plugin_id": "org/broken",
                        "declaration": {
                            "identity": {"name": "broken"},
                            "tools": [{"name": "missing-identity"}, "not-a-dict"],
                        },
                    },
                ]
            }
            transformed = transformer(payload)
            assert len(transformed["data"]) == 2
            assert transformed["data"][0]["declaration"]["tools"][0]["identity"]["provider"] == "good"
            assert transformed["data"][1]["declaration"]["tools"] == []
            return [sibling, broken]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_tool_providers("tenant-1")

        assert request_mock.call_count == 1
        assert [provider.declaration.identity.name for provider in result] == [
            "org/plugin/good",
            "org/plugin/broken",
        ]

    def test_fetch_tool_providers_keeps_siblings_when_one_declaration_is_invalid(self, mocker: MockerFixture):
        manager = PluginToolManager()
        valid = {
            "provider": "weather",
            "plugin_unique_identifier": "langgenius/weather:0.0.1@abc",
            "plugin_id": "langgenius/weather",
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "weather",
                    "description": {"en_US": "Weather"},
                    "icon": "icon.svg",
                    "label": {"en_US": "Weather"},
                },
                "tools": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "get_weather",
                            "label": {"en_US": "Get Weather"},
                            "provider": "weather",
                        },
                        "description": {"human": {"en_US": "Get weather"}, "llm": "Get weather"},
                    },
                    {"name": "broken-tool-without-identity"},
                ],
            },
        }
        sibling = {
            "provider": "search",
            "plugin_unique_identifier": "langgenius/search:0.0.1@def",
            "plugin_id": "langgenius/search",
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "search",
                    "description": {"en_US": "Search"},
                    "icon": "icon.svg",
                    "label": {"en_US": "Search"},
                },
                "tools": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "web_search",
                            "label": {"en_US": "Web Search"},
                            "provider": "search",
                        },
                        "description": {"human": {"en_US": "Search the web"}, "llm": "Search the web"},
                    }
                ],
            },
        }
        mocker.patch.object(
            manager,
            "_request",
            return_value=_ResponseStub(
                {
                    "code": 0,
                    "message": "",
                    "data": [valid, {"plugin_id": "langgenius/corrupt", "provider": "corrupt"}, sibling],
                }
            ),
        )

        result = manager.fetch_tool_providers("tenant-1")

        assert [provider.plugin_id for provider in result] == ["langgenius/weather", "langgenius/search"]
        assert [tool.identity.name for tool in result[0].declaration.tools] == ["get_weather"]
        assert result[1].declaration.identity.name == "langgenius/search/search"

    def test_fetch_tool_providers_skips_multiple_true_on_non_select_parameter(self, mocker: MockerFixture):
        manager = PluginToolManager()
        mocker.patch.object(
            manager,
            "_request",
            return_value=_ResponseStub({"code": 0, "message": "", "data": _issue_41605_management_tools_list()}),
        )

        result = manager.fetch_tool_providers("tenant-1")

        assert [provider.plugin_id for provider in result] == [
            "langgenius/provider-0",
            "langgenius/provider-1",
            "langgenius/provider-2",
            "langgenius/search",
        ]
        assert result[-1].declaration.identity.name == "langgenius/search/search"

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
