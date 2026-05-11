import asyncio
from collections import OrderedDict
from typing import cast

import pytest

from agenton.compositor import Compositor
from agenton.layers import EmptyRuntimeHandles, EmptyRuntimeState, LayerControl, PlainPromptType, PlainToolType
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
            model_provider="openai",
            model="demo-model",
            credentials={"api_key": "secret"},
            model_settings={"temperature": 0.2},
        )
    )


def _plugin_control(control: LayerControl) -> LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles]:
    return cast(LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles], control)


def _llm_control(control: LayerControl) -> LayerControl[EmptyRuntimeState, EmptyRuntimeHandles]:
    return cast(LayerControl[EmptyRuntimeState, EmptyRuntimeHandles], control)


def test_dify_plugin_layer_uses_resource_stack_and_get_daemon_provider_requires_active_control() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("plugin", plugin)]))
        session = compositor.new_session()

        with pytest.raises(RuntimeError, match="requires an active LayerControl"):
            _ = plugin.get_daemon_provider(_plugin_control(session.layer("plugin")))

        async with compositor.enter(session) as active_session:
            handles = cast(DifyPluginRuntimeHandles, cast(object, session.layer("plugin").runtime_handles))
            first_client = handles.http_client
            assert first_client is not None
            provider = plugin.get_daemon_provider(_plugin_control(session.layer("plugin")))
            assert provider.name == "DifyPlugin/langgenius/openai"
            assert provider.client.http_client is first_client
            assert provider.client.tenant_id == "tenant-1"
            assert provider.client.plugin_id == "langgenius/openai"
            assert provider.client.user_id == "user-1"
            async with provider:
                pass
            assert first_client.is_closed is False
            active_session.suspend_on_exit()

        assert handles.http_client is None
        assert first_client.is_closed is True
        with pytest.raises(RuntimeError, match="requires an active LayerControl"):
            _ = plugin.get_daemon_provider(_plugin_control(session.layer("plugin")))

        async with compositor.enter(session):
            second_client = handles.http_client
            assert second_client is not None
            assert second_client is not first_client

        assert handles.http_client is None
        assert second_client.is_closed is True

    asyncio.run(scenario())


def test_dify_plugin_layer_get_daemon_provider_rejects_wrong_control() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        llm = _llm_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
            layers=OrderedDict([("plugin", plugin), ("llm", llm)]),
            deps_name_mapping={"llm": {"plugin": "plugin"}},
        )

        async with compositor.enter() as session:
            with pytest.raises(RuntimeError, match="belongs to layer 'llm'"):
                _ = plugin.get_daemon_provider(_plugin_control(session.layer("llm")))

    asyncio.run(scenario())


def test_dify_plugin_llm_layer_builds_adapter_model_from_dependency_provider() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        llm = _llm_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
            layers=OrderedDict([("plugin", plugin), ("llm", llm)]),
            deps_name_mapping={"llm": {"plugin": "plugin"}},
        )

        session = compositor.new_session()
        with pytest.raises(RuntimeError, match="requires an active LayerControl"):
            _ = llm.get_model(_llm_control(session.layer("llm")))

        async with compositor.enter(session):
            model = llm.get_model(_llm_control(session.layer("llm")))
            assert isinstance(model, DifyLLMAdapterModel)
            assert model.model_name == "demo-model"
            assert model.model_provider == "openai"
            assert model.credentials == {"api_key": "secret"}
            assert model.provider.name == "DifyPlugin/langgenius/openai"
            handles = cast(DifyPluginRuntimeHandles, cast(object, session.layer("plugin").runtime_handles))
            assert model.provider.client.http_client is handles.http_client

            with pytest.raises(RuntimeError, match="belongs to layer 'plugin'"):
                _ = llm.get_model(_llm_control(session.layer("plugin")))

    asyncio.run(scenario())


def test_dify_plugin_llm_layer_get_model_uses_control_dependency_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        llm = _llm_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
            layers=OrderedDict([("renamed-plugin", plugin), ("llm", llm)]),
            deps_name_mapping={"llm": {"plugin": "renamed-plugin"}},
        )

        async with compositor.enter() as session:
            llm_control = session.layer("llm")
            plugin_control = session.layer("renamed-plugin")
            calls: list[object] = []

            def fake_control_for(self: LayerControl, dep_layer: object) -> object:
                assert self is llm_control
                calls.append(dep_layer)
                return plugin_control

            monkeypatch.setattr(LayerControl, "control_for", fake_control_for)

            model = llm.get_model(llm_control)

        assert calls == [plugin]
        assert isinstance(model, DifyLLMAdapterModel)

    asyncio.run(scenario())


def test_dify_plugin_layer_concurrent_sessions_use_separate_controls_and_clients() -> None:
    async def scenario() -> None:
        plugin = _plugin_layer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("plugin", plugin)]))
        first_session = compositor.new_session()
        second_session = compositor.new_session()

        async with compositor.enter(first_session):
            async with compositor.enter(second_session):
                first_handles = cast(
                    DifyPluginRuntimeHandles,
                    cast(object, first_session.layer("plugin").runtime_handles),
                )
                second_handles = cast(
                    DifyPluginRuntimeHandles,
                    cast(object, second_session.layer("plugin").runtime_handles),
                )
                first_client = first_handles.http_client
                second_client = second_handles.http_client
                assert first_client is not None
                assert second_client is not None
                assert first_client is not second_client

                first_provider = plugin.get_daemon_provider(_plugin_control(first_session.layer("plugin")))
                second_provider = plugin.get_daemon_provider(_plugin_control(second_session.layer("plugin")))
                assert first_provider.client.http_client is first_client
                assert second_provider.client.http_client is second_client

            assert second_client.is_closed is True
            assert first_client.is_closed is False

        assert first_client.is_closed is True

    asyncio.run(scenario())
