from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict

from agenton.compositor import LayerRegistry
from agenton.layers import EmptyLayerConfig, EmptyRuntimeHandles, EmptyRuntimeState, LayerControl, NoLayerDeps, PlainLayer


class InferredConfig(BaseModel):
    value: str = "configured"

    model_config = ConfigDict(extra="forbid")


class InferredState(BaseModel):
    count: int = 0

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class InferredHandles(BaseModel):
    token: object | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


@dataclass(slots=True)
class GenericSchemaLayer(PlainLayer[NoLayerDeps, InferredConfig, InferredState, InferredHandles]):
    type_id = "test.generic-schema"

    async def on_context_create(self, control: LayerControl[InferredState, InferredHandles]) -> None:
        control.runtime_state.count += 1
        control.runtime_handles.token = object()


@dataclass(slots=True)
class DefaultSchemaLayer(PlainLayer[NoLayerDeps]):
    type_id = "test.default-schema"


def test_layer_infers_config_runtime_state_and_handles_from_generics() -> None:
    layer = GenericSchemaLayer()
    control = layer.new_control(runtime_state={"count": 3})

    assert GenericSchemaLayer.config_type is InferredConfig
    assert GenericSchemaLayer.runtime_state_type is InferredState
    assert GenericSchemaLayer.runtime_handles_type is InferredHandles
    assert isinstance(control.runtime_state, InferredState)
    assert control.runtime_state.count == 3
    assert isinstance(control.runtime_handles, InferredHandles)


def test_layer_uses_empty_schema_defaults_when_omitted() -> None:
    layer = DefaultSchemaLayer()
    control = layer.new_control()

    assert DefaultSchemaLayer.config_type is EmptyLayerConfig
    assert DefaultSchemaLayer.runtime_state_type is EmptyRuntimeState
    assert DefaultSchemaLayer.runtime_handles_type is EmptyRuntimeHandles
    assert isinstance(control.runtime_state, EmptyRuntimeState)
    assert isinstance(control.runtime_handles, EmptyRuntimeHandles)


def test_invalid_declared_schema_type_is_rejected_clearly() -> None:
    try:

        class InvalidSchemaLayer(PlainLayer[NoLayerDeps]):
            config_type = dict  # pyright: ignore[reportAssignmentType]

    except TypeError as e:
        assert str(e) == "InvalidSchemaLayer.config_type must be a Pydantic BaseModel subclass."
    else:
        raise AssertionError("Expected TypeError.")

    try:

        class InvalidGenericSchemaLayer(PlainLayer[NoLayerDeps, dict[str, object]]):  # pyright: ignore[reportInvalidTypeArguments]
            pass

    except TypeError as e:
        assert str(e) == "InvalidGenericSchemaLayer.config_type must be a Pydantic BaseModel subclass."
    else:
        raise AssertionError("Expected TypeError.")


def test_registry_descriptor_uses_inferred_schema_types() -> None:
    registry = LayerRegistry()
    registry.register_layer(GenericSchemaLayer)

    descriptor = registry.resolve("test.generic-schema")

    assert descriptor.config_type is InferredConfig
    assert descriptor.runtime_state_type is InferredState
    assert descriptor.runtime_handles_type is InferredHandles
