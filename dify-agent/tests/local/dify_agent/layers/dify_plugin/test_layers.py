import asyncio
from collections import OrderedDict
from typing import cast

from agenton.compositor import Compositor
from agenton.layers import PlainPromptType, PlainToolType
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer, DifyPluginRuntimeHandles


def _plugin_layer() -> DifyPluginLayer:
    return DifyPluginLayer.from_config_with_settings(
        DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai", user_id="user-1"),
        daemon_url="http://plugin-daemon",
        daemon_api_key="daemon-secret",
        timeout=12,
    )


def _llm_layer() -> DifyPluginLLMLayer:
    return DifyPluginLLMLayer.from_config(
        DifyPluginLLMLayerConfig(
            provider="openai",
            model="demo-model",
            credentials={"api_key": "secret"},
            model_settings={"temperature": 0.2},
        )
    )


def test_dify_plugin_layer_get_provider_requires_active_context_and_uses_runtime_client() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("plugin", plugin)]))

        try:
            _ = plugin.get_provider(plugin_provider="openai")
        except RuntimeError as e:
            assert str(e) == "DifyPluginLayer.get_provider() requires an active compositor context."
        else:
            raise AssertionError("Expected RuntimeError.")

        async with compositor.enter() as session:
            handles = cast(DifyPluginRuntimeHandles, cast(object, session.layer("plugin").runtime_handles))
            client = handles.http_client
            assert client is not None
            provider = plugin.get_provider(plugin_provider="openai")
            assert provider.client.http_client is client
            assert provider.client.tenant_id == "tenant-1"
            assert provider.client.plugin_id == "langgenius/openai"
            assert provider.client.provider == "openai"
            assert provider.client.user_id == "user-1"
            async with provider:
                pass
            assert client.is_closed is False

        assert client.is_closed is True

    asyncio.run(scenario())


def test_dify_plugin_llm_layer_builds_adapter_model_from_dependency_provider() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        llm = _llm_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
            layers=OrderedDict([("plugin", plugin), ("llm", llm)]),
            deps_name_mapping={"llm": {"plugin": "plugin"}},
        )

        async with compositor.enter() as session:
            model = llm.get_model()
            assert isinstance(model, DifyLLMAdapterModel)
            assert model.model_name == "demo-model"
            assert model.credentials == {"api_key": "secret"}
            assert model.provider.name == "DifyPlugin/openai"
            handles = cast(DifyPluginRuntimeHandles, cast(object, session.layer("plugin").runtime_handles))
            assert model.provider.client.http_client is handles.http_client

    asyncio.run(scenario())
