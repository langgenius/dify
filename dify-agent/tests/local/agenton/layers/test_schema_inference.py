from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict

from agenton.compositor import LayerProvider
from agenton.layers import (
    EmptyLayerConfig,
    EmptyRuntimeState,
    LayerConfig,
    NoLayerDeps,
    PlainLayer,
)


class InferredConfig(LayerConfig):
    value: str = "configured"

    model_config = ConfigDict(extra="forbid")


class InferredState(BaseModel):
    count: int = 0

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


@dataclass(slots=True)
class GenericSchemaLayer(PlainLayer[NoLayerDeps, InferredConfig, InferredState]):
    type_id = "test.generic-schema"

    @classmethod
    def from_config(cls, config: InferredConfig) -> "GenericSchemaLayer":
        return cls()

    async def on_context_create(self) -> None:
        self.runtime_state.count += 1


@dataclass(slots=True)
class DefaultSchemaLayer(PlainLayer[NoLayerDeps]):
    type_id = "test.default-schema"


def test_layer_infers_config_and_runtime_state_from_generics() -> None:
    layer = GenericSchemaLayer()
    layer.runtime_state = InferredState(count=3)

    assert GenericSchemaLayer.config_type is InferredConfig
    assert GenericSchemaLayer.runtime_state_type is InferredState
    assert isinstance(layer.runtime_state, InferredState)
    assert layer.runtime_state.count == 3


def test_layer_uses_empty_schema_defaults_when_omitted() -> None:
    layer = DefaultSchemaLayer()

    assert DefaultSchemaLayer.config_type is EmptyLayerConfig
    assert DefaultSchemaLayer.runtime_state_type is EmptyRuntimeState
    assert isinstance(layer.runtime_state, EmptyRuntimeState)


def test_invalid_declared_schema_type_is_rejected_clearly() -> None:
    try:

        class InvalidSchemaLayer(PlainLayer[NoLayerDeps]):
            config_type = dict  # pyright: ignore[reportAssignmentType]

    except TypeError as e:
        assert str(e) == "InvalidSchemaLayer.config_type must be a LayerConfig subclass."
    else:
        raise AssertionError("Expected TypeError.")

    try:

        class InvalidGenericSchemaLayer(PlainLayer[NoLayerDeps, dict[str, object]]):  # pyright: ignore[reportInvalidTypeArguments]
            pass

    except TypeError as e:
        assert str(e) == "InvalidGenericSchemaLayer.config_type must be a LayerConfig subclass."
    else:
        raise AssertionError("Expected TypeError.")


def test_layer_provider_uses_inferred_schema_types() -> None:
    provider = LayerProvider.from_layer_type(GenericSchemaLayer)

    layer = provider.create_layer({"value": "configured"})

    assert provider.type_id == "test.generic-schema"
    assert provider.layer_type.config_type is InferredConfig
    assert provider.layer_type.runtime_state_type is InferredState
    assert isinstance(layer.config, InferredConfig)
