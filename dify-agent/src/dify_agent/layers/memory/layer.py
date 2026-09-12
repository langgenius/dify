"""External memory uses plugin tools privately, outside model tool selection.

The API prepares credential-bearing tool configs for each invocation. No secrets,
recalled text or captured payloads are placed in this layer's session state.
The runner binds the capability to its shared daemon client for one run.
"""

from dataclasses import dataclass
from typing import ClassVar, Self

from agenton.layers import EmptyRuntimeState, LayerDeps, PlainLayer
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.memory.configs import DIFY_MEMORY_LAYER_ID, DIFY_MEMORY_LAYER_TYPE_ID, DifyMemoryLayerConfig
from dify_agent.protocol.schemas import RunComposition


class DifyMemoryDeps(LayerDeps):
    execution_context: DifyExecutionContextLayer


@dataclass
class DifyMemoryLayer(PlainLayer[DifyMemoryDeps, DifyMemoryLayerConfig, EmptyRuntimeState]):
    type_id: ClassVar[str | None] = DIFY_MEMORY_LAYER_TYPE_ID
    config: DifyMemoryLayerConfig

    @classmethod
    def from_config(cls, config: DifyMemoryLayerConfig) -> Self:
        return cls(config=DifyMemoryLayerConfig.model_validate(config))


def validate_memory_layer_composition(composition: RunComposition) -> None:
    """Reject memory configurations that the runner cannot activate."""
    layers = [layer for layer in composition.layers if layer.type == DIFY_MEMORY_LAYER_TYPE_ID]
    if len(layers) > 1:
        raise ValueError("Only one external memory layer is supported per run")
    for layer in composition.layers:
        if layer.type == DIFY_MEMORY_LAYER_TYPE_ID and layer.name != DIFY_MEMORY_LAYER_ID:
            raise ValueError(f"External memory must use reserved layer name '{DIFY_MEMORY_LAYER_ID}'")
        if layer.name == DIFY_MEMORY_LAYER_ID and layer.type != DIFY_MEMORY_LAYER_TYPE_ID:
            raise ValueError(f"Reserved layer '{DIFY_MEMORY_LAYER_ID}' requires type '{DIFY_MEMORY_LAYER_TYPE_ID}'")
