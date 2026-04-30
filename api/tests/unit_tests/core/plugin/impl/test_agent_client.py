from types import SimpleNamespace

from core.plugin.entities.request import PluginInvokeContext
from core.plugin.impl.agent import PluginAgentClient


def _agent_provider(name: str = "agent") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            strategies=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginAgentClient:
    def test_fetch_agent_strategy_providers(self, mocker):
        client = PluginAgentClient()
        provider = _agent_provider("remote")

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "strategies": [{"identity": {"provider": "old"}}],
                        }
                    }
                ]
            }
            transformed = transformer(payload)
            assert transformed["data"][0]["declaration"]["strategies"][0]["identity"]["provider"] == "remote"
            return [provider]

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_agent_strategy_providers("tenant-1")

        assert request_mock.call_count == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.strategies[0].identity.provider == "org/plugin/remote"

    def test_fetch_agent_strategy_provider(self, mocker):
        client = PluginAgentClient()
        provider = _agent_provider("provider")

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            assert transformer({"data": None}) == {"data": None}
            payload = {"data": {"declaration": {"strategies": [{"identity": {"provider": "old"}}]}}}
            transformed = transformer(payload)
            assert transformed["data"]["declaration"]["strategies"][0]["identity"]["provider"] == "provider"
            return provider

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_agent_strategy_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.strategies[0].identity.provider == "org/plugin/provider"

    def test_invoke_merges_chunks_and_passes_context(self, mocker):
        client = PluginAgentClient()
        stream_mock = mocker.patch.object(
            client, "_request_with_plugin_daemon_response_stream", return_value=iter(["raw"])
        )
        merge_mock = mocker.patch("core.plugin.impl.agent.merge_blob_chunks", return_value=["merged"])
        context = PluginInvokeContext()

        result = client.invoke(
            tenant_id="tenant-1",
            user_id="user-1",
            agent_provider="org/plugin/provider",
            agent_strategy="router",
            agent_params={"k": "v"},
            conversation_id="conv-1",
            app_id="app-1",
            message_id="msg-1",
            context=context,
        )

        assert result == ["merged"]
        assert merge_mock.call_count == 1
        payload = stream_mock.call_args.kwargs["data"]
        assert payload["data"]["agent_strategy_provider"] == "provider"
        assert payload["context"] == context.model_dump()
        assert stream_mock.call_args.kwargs["headers"]["X-Plugin-ID"] == "org/plugin"
