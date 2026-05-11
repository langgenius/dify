"""Dify plugin LLM model layer.

This layer owns model capability resolution for Dify plugin-backed LLMs. It
depends on ``DifyPluginLayer`` for daemon access, resolves that dependency's
control from its own ``LayerControl``, and returns a Pydantic AI model adapter
configured from the public LLM layer DTO. The daemon provider carries plugin
transport identity; the DTO's ``model_provider`` is passed to the adapter as
request-level model identity.
"""

from dataclasses import dataclass

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeHandles, EmptyRuntimeState, LayerControl, LayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer


class DifyPluginLLMDeps(LayerDeps):
    """Dependencies required by ``DifyPluginLLMLayer``."""

    plugin: DifyPluginLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginLLMLayer(PlainLayer[DifyPluginLLMDeps, DifyPluginLLMLayerConfig]):
    """Layer that creates the Dify plugin-daemon Pydantic AI model."""

    type_id = "dify.plugin.llm"

    config: DifyPluginLLMLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLLMLayerConfig) -> Self:
        """Create the LLM layer from validated public config."""
        return cls(config=config)

    def get_model(self, control: LayerControl[EmptyRuntimeState, EmptyRuntimeHandles]) -> DifyLLMAdapterModel:
        """Return the configured model using the current session's plugin control."""
        control = self.require_control(control, active=True)
        plugin_control = control.control_for(self.deps.plugin)
        provider = self.deps.plugin.get_daemon_provider(plugin_control)
        return DifyLLMAdapterModel(
            model=self.config.model,
            daemon_provider=provider,
            model_provider=self.config.model_provider,
            credentials=dict(self.config.credentials),
            model_settings=self.config.model_settings,
        )


__all__ = ["DifyPluginLLMDeps", "DifyPluginLLMLayer"]
