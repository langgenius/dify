import asyncio

import httpx
import pytest

from agenton.compositor import Compositor, LayerNode, LayerProvider
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import (
    DIFY_PLUGIN_LAYER_TYPE_ID,
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer


def _plugin_config() -> DifyPluginLayerConfig:
    return DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai", user_id="user-1")


def _llm_config() -> DifyPluginLLMLayerConfig:
    return DifyPluginLLMLayerConfig(
        model_provider="openai",
        model="demo-model",
        credentials={"api_key": "secret"},
        model_settings={"temperature": 0.2},
    )


def _plugin_layer() -> DifyPluginLayer:
    return DifyPluginLayer.from_config_with_settings(
        _plugin_config(),
        daemon_url="http://plugin-daemon",
        daemon_api_key="daemon-secret",
    )


def _plugin_provider() -> LayerProvider[DifyPluginLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyPluginLayer,
        create=lambda config: DifyPluginLayer.from_config_with_settings(
            DifyPluginLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )


def test_dify_plugin_type_id_constants_match_implementation_classes() -> None:
    assert DIFY_PLUGIN_LAYER_TYPE_ID == DifyPluginLayer.type_id
    assert DIFY_PLUGIN_LLM_LAYER_TYPE_ID == DifyPluginLLMLayer.type_id


def test_dify_plugin_layer_creates_daemon_provider_from_shared_http_client() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            provider = plugin.create_daemon_provider(http_client=client)

            assert provider.name == "DifyPlugin/langgenius/openai"
            assert provider.client.http_client is client
            assert provider.client.tenant_id == "tenant-1"
            assert provider.client.plugin_id == "langgenius/openai"
            assert provider.client.user_id == "user-1"

            async with provider:
                pass
            assert client.is_closed is False

    asyncio.run(scenario())


def test_dify_plugin_layer_rejects_closed_shared_http_client() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        client = httpx.AsyncClient()
        await client.aclose()

        with pytest.raises(RuntimeError, match="open shared HTTP client"):
            _ = plugin.create_daemon_provider(http_client=client)

    asyncio.run(scenario())


def test_dify_plugin_llm_layer_builds_adapter_model_from_direct_dependency() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("renamed-plugin", _plugin_provider()),
                LayerNode("llm", DifyPluginLLMLayer, deps={"plugin": "renamed-plugin"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            async with compositor.enter(
                configs={
                    "renamed-plugin": _plugin_config(),
                    "llm": _llm_config(),
                }
            ) as run:
                plugin = run.get_layer("renamed-plugin", DifyPluginLayer)
                llm = run.get_layer("llm", DifyPluginLLMLayer)

                model = llm.get_model(http_client=client)

                assert llm.deps.plugin is plugin
                assert isinstance(model, DifyLLMAdapterModel)
                assert model.model_name == "demo-model"
                assert model.model_provider == "openai"
                assert model.credentials == {"api_key": "secret"}
                assert model.provider.name == "DifyPlugin/langgenius/openai"
                assert model.provider.client.http_client is client

    asyncio.run(scenario())


def test_dify_plugin_layer_lifecycle_does_not_manage_http_client() -> None:
    async def scenario() -> None:
        compositor = Compositor([LayerNode("plugin", _plugin_provider())])
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            async with compositor.enter(configs={"plugin": _plugin_config()}) as run:
                plugin = run.get_layer("plugin", DifyPluginLayer)
                provider = plugin.create_daemon_provider(http_client=client)
                run.suspend_layer_on_exit("plugin")

            assert run.session_snapshot is not None
            assert provider.client.http_client is client
            assert client.is_closed is False

    asyncio.run(scenario())
