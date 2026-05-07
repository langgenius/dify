import asyncio
from collections import OrderedDict
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, ValidationError
from typing_extensions import override

from agenton.compositor import Compositor, CompositorBuilder, CompositorSession, LayerRegistry
from agenton.layers import EmptyLayerConfig, LayerControl, LayerDeps, NoLayerDeps, PlainLayer, PlainPromptType, PlainToolType
from agenton_collections.layers.plain import ObjectLayer, PromptLayer


def test_registry_infers_descriptor_and_rejects_duplicate_or_missing_type_id() -> None:
    registry = LayerRegistry()
    registry.register_layer(PromptLayer)

    descriptor = registry.resolve("plain.prompt")
    assert descriptor.layer_type is PromptLayer
    assert descriptor.config_type is PromptLayer.config_type

    try:
        registry.register_layer(PromptLayer)
    except ValueError as e:
        assert str(e) == "Layer type id 'plain.prompt' is already registered."
    else:
        raise AssertionError("Expected ValueError.")

    try:
        registry.register_layer(InstanceOnlyLayer)
    except ValueError as e:
        assert "must declare a type_id" in str(e)
    else:
        raise AssertionError("Expected ValueError.")

    try:
        registry.register_layer(InstanceOnlyLayer, type_id=123)  # pyright: ignore[reportArgumentType]
    except TypeError as e:
        assert str(e) == "Layer type id for 'InstanceOnlyLayer' must be a string."
    else:
        raise AssertionError("Expected TypeError.")


@dataclass(slots=True)
class InstanceOnlyLayer(PlainLayer[NoLayerDeps]):
    pass


def test_builder_creates_config_layers_with_typed_validation() -> None:
    registry = LayerRegistry()
    registry.register_layer(PromptLayer)

    compositor = (
        CompositorBuilder(registry)
        .add_config_layer(
            name="prompt",
            type="plain.prompt",
            config={"prefix": "hello", "user": "ask politely", "suffix": ["bye"]},
        )
        .build()
    )

    assert [prompt.value for prompt in compositor.prompts] == ["hello", "bye"]
    assert [prompt.value for prompt in compositor.user_prompts] == ["ask politely"]

    try:
        CompositorBuilder(registry).add_config_layer(
            name="bad",
            type="plain.prompt",
            config={"unknown": "field"},
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("Expected ValidationError.")


class ObjectConsumerDeps(LayerDeps):
    obj: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class ObjectConsumerLayer(PlainLayer[ObjectConsumerDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.deps.obj.value]


def test_builder_mixes_config_and_instances_and_rejects_invalid_deps() -> None:
    registry = LayerRegistry()
    registry.register_layer(PromptLayer)

    compositor = (
        CompositorBuilder(registry)
        .add_config({"layers": [{"name": "prompt", "type": "plain.prompt", "config": {"prefix": "cfg"}}]})
        .add_instance(name="obj", layer=ObjectLayer("instance"))
        .add_instance(name="consumer", layer=ObjectConsumerLayer(), deps={"obj": "obj"})
        .build()
    )

    assert [prompt.value for prompt in compositor.prompts] == ["cfg", "instance"]

    try:
        CompositorBuilder(registry).add_instance(
            name="consumer",
            layer=ObjectConsumerLayer(),
            deps={"missing_dep_key": "obj"},
        ).build()
    except ValueError as e:
        assert str(e) == "Layer 'consumer' declares unknown dependency keys: missing_dep_key."
    else:
        raise AssertionError("Expected ValueError.")

    try:
        CompositorBuilder(registry).add_instance(
            name="consumer",
            layer=ObjectConsumerLayer(),
            deps={"obj": "missing_target"},
        ).build()
    except ValueError as e:
        assert str(e) == "Layer 'consumer' depends on undefined layer names: missing_target."
    else:
        raise AssertionError("Expected ValueError.")


class HandleState(BaseModel):
    resource_id: str = ""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class HandleBox:
    def __init__(self, value: str) -> None:
        self.value = value


class HandleModels(BaseModel):
    handle: HandleBox | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


@dataclass(slots=True)
class HandleLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, HandleState, HandleModels]):
    created: int = 0
    resumed: int = 0

    @override
    async def on_context_create(self, control: LayerControl[HandleState, HandleModels]) -> None:
        self.created += 1
        control.runtime_handles.handle = HandleBox(control.runtime_state.resource_id)

    @override
    async def on_context_resume(self, control: LayerControl[HandleState, HandleModels]) -> None:
        self.resumed += 1
        control.runtime_handles.handle = HandleBox(f"resumed:{control.runtime_state.resource_id}")


def test_new_session_uses_layer_runtime_schemas() -> None:
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("handle", HandleLayer())])
    )
    session = compositor.new_session()

    assert isinstance(session.layer("handle").runtime_state, HandleState)
    assert isinstance(session.layer("handle").runtime_handles, HandleModels)


def test_enter_rejects_bad_session_runtime_schemas_before_layer_hooks() -> None:
    layer = HandleLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("handle", layer)]))
    bad_session = CompositorSession(OrderedDict([("handle", LayerControl())]))

    async def run() -> None:
        async with compositor.enter(bad_session):
            pass

    try:
        asyncio.run(run())
    except TypeError as e:
        assert str(e) == (
            "CompositorSession layer 'handle' runtime_state must be HandleState, "
            "got EmptyRuntimeState."
        )
    else:
        raise AssertionError("Expected TypeError.")

    assert layer.created == 0


def test_snapshot_rejects_active_sessions_and_excludes_handles() -> None:
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("handle", HandleLayer())])
    )
    session = compositor.session_from_snapshot(
        {"layers": [{"name": "handle", "state": "new", "runtime_state": {"resource_id": "abc"}}]}
    )

    async def run() -> None:
        async with compositor.enter(session):
            try:
                compositor.snapshot_session(session)
            except RuntimeError as e:
                assert str(e) == "Cannot snapshot active compositor session layers: handle."
            else:
                raise AssertionError("Expected RuntimeError.")

    asyncio.run(run())

    snapshot = compositor.snapshot_session(session)
    assert snapshot.model_dump(mode="json") == {
        "schema_version": 1,
        "layers": [{"name": "handle", "state": "closed", "runtime_state": {"resource_id": "abc"}}],
    }


def test_restore_validates_runtime_state_and_resume_rehydrates_handles() -> None:
    layer = HandleLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("handle", layer)]))

    try:
        compositor.session_from_snapshot(
            {"layers": [{"name": "handle", "state": "suspended", "runtime_state": {"wrong": "field"}}]}
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("Expected ValidationError.")

    restored = compositor.session_from_snapshot(
        {"layers": [{"name": "handle", "state": "suspended", "runtime_state": {"resource_id": "abc"}}]}
    )

    async def run() -> None:
        async with compositor.enter(restored):
            control = restored.layer("handle")
            assert isinstance(control.runtime_handles, HandleModels)
            assert control.runtime_handles.handle is not None
            assert control.runtime_handles.handle.value == "resumed:abc"

    asyncio.run(run())

    assert layer.resumed == 1


def test_session_from_snapshot_rejects_active_layer_state() -> None:
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("handle", HandleLayer())])
    )

    try:
        compositor.session_from_snapshot(
            {"layers": [{"name": "handle", "state": "active", "runtime_state": {"resource_id": "abc"}}]}
        )
    except ValueError as e:
        assert str(e) == "Cannot restore active compositor session layers from snapshot: handle."
    else:
        raise AssertionError("Expected ValueError.")
