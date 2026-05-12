import asyncio
from dataclasses import dataclass

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError
from typing_extensions import override

import agenton.compositor as compositor_module
import agenton.layers as layers_module
from agenton.compositor import (
    Compositor,
    LayerConfigInput,
    LayerNode,
    LayerNodeConfig,
    LayerProvider,
    LayerProviderInput,
)
from agenton.layers import EmptyLayerConfig, Layer, LayerDeps, NoLayerDeps, PlainLayer
from agenton_collections.layers.plain import ObjectLayer, PromptLayer, PromptLayerConfig


EXPECTED_FACADE_EXPORTS = [
    "Compositor",
    "CompositorConfig",
    "CompositorConfigValue",
    "CompositorRun",
    "CompositorSessionSnapshot",
    "CompositorSessionSnapshotValue",
    "CompositorTransformer",
    "CompositorTransformerKwargs",
    "LayerFactory",
    "LayerNode",
    "LayerNodeConfig",
    "LayerProvider",
    "LayerRunSlot",
    "LayerSessionSnapshot",
]

EXPECTED_DIRECT_IMPORT_COMPAT_NAMES = ["LayerConfigInput", "LayerProviderInput"]


@dataclass(slots=True)
class InstanceOnlyLayer(PlainLayer[NoLayerDeps]):
    pass


@dataclass(slots=True)
class RequiredConstructorLayer(PlainLayer[NoLayerDeps]):
    value: str


def test_layer_provider_from_layer_type_uses_declared_schema_and_type_id() -> None:
    provider = LayerProvider.from_layer_type(PromptLayer)

    assert provider.type_id == "plain.prompt"
    assert provider.layer_type is PromptLayer

    layer = provider.create_layer(PromptLayerConfig(prefix="hello", user="ask politely"))

    assert isinstance(layer, PromptLayer)
    assert layer.config == PromptLayerConfig(prefix="hello", user="ask politely")
    assert layer.prefix_prompts == ["hello"]

    with pytest.raises(TypeError, match="cannot be created from empty config"):
        LayerProvider.from_layer_type(RequiredConstructorLayer).create_layer()


def test_compositor_from_config_uses_providers_and_enter_configs_by_node_name() -> None:
    compositor = Compositor.from_config(
        {"layers": [{"name": "prompt", "type": "plain.prompt"}]},
        providers=[PromptLayer],
    )

    async def run() -> None:
        async with compositor.enter(
            configs={"prompt": {"prefix": "hello", "user": "ask politely", "suffix": ["bye"]}}
        ) as active_run:
            assert [prompt.value for prompt in active_run.prompts] == ["hello", "bye"]
            assert [prompt.value for prompt in active_run.user_prompts] == ["ask politely"]

    asyncio.run(run())

    with pytest.raises(ValidationError):
        asyncio.run(_enter_once(compositor, configs={"prompt": {"unknown": "field"}}))


def test_layer_node_config_has_no_runtime_state_or_layer_config() -> None:
    node = LayerNodeConfig(
        name="prompt",
        type="plain.prompt",
        deps={"source": "other"},
        metadata={"label": "Prompt"},
    )

    assert node.model_dump(mode="json") == {
        "name": "prompt",
        "type": "plain.prompt",
        "deps": {"source": "other"},
        "metadata": {"label": "Prompt"},
    }
    assert "runtime_state" not in LayerNodeConfig.model_fields
    assert "config" not in LayerNodeConfig.model_fields


def test_node_providers_override_type_id_providers_for_serializable_graphs() -> None:
    override_provider = LayerProvider.from_factory(
        layer_type=PromptLayer,
        create=lambda config: PromptLayer(prefix="override"),
    )
    compositor = Compositor.from_config(
        {"layers": [{"name": "prompt", "type": "plain.prompt"}]},
        providers=[PromptLayer],
        node_providers={"prompt": override_provider},
    )

    async def run() -> None:
        async with compositor.enter(configs={"prompt": {"prefix": "ignored"}}) as active_run:
            assert [prompt.value for prompt in active_run.prompts] == ["override"]

    asyncio.run(run())


def test_from_config_rejects_missing_duplicate_and_unknown_providers() -> None:
    with pytest.raises(KeyError, match="Layer type id 'missing' is not registered"):
        Compositor.from_config({"layers": [{"name": "node", "type": "missing"}]}, providers=[])

    with pytest.raises(ValueError, match="already registered"):
        Compositor.from_config(
            {"layers": [{"name": "prompt", "type": "plain.prompt"}]},
            providers=[PromptLayer, PromptLayer],
        )

    with pytest.raises(ValueError, match="must declare a type_id"):
        Compositor.from_config(
            {"layers": [{"name": "node", "type": "instance.only"}]},
            providers=[InstanceOnlyLayer],
        )

    with pytest.raises(ValueError, match="unknown layer node names: other"):
        Compositor.from_config(
            {"layers": [{"name": "prompt", "type": "plain.prompt"}]},
            providers=[PromptLayer],
            node_providers={"other": PromptLayer},
        )


def test_compositor_run_get_layer_returns_named_layer_and_validates_type() -> None:
    compositor = Compositor([LayerNode("obj", _object_provider("value"))])

    async def run() -> None:
        async with compositor.enter() as active_run:
            layer = active_run.get_layer("obj", ObjectLayer)
            assert active_run.get_layer("obj") is layer
            assert layer.value == "value"

            with pytest.raises(KeyError, match="Layer 'missing' is not defined"):
                active_run.get_layer("missing")

            with pytest.raises(TypeError, match="Layer 'obj' must be PromptLayer, got ObjectLayer"):
                active_run.get_layer("obj", PromptLayer)

    asyncio.run(run())


class ObjectConsumerDeps(LayerDeps):
    obj: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class ObjectConsumerLayer(PlainLayer[ObjectConsumerDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.deps.obj.value]


def test_python_native_construction_mixes_layer_classes_and_providers() -> None:
    compositor = Compositor(
        [
            LayerNode("prompt", PromptLayer),
            LayerNode("obj", _object_provider("instance")),
            LayerNode("consumer", ObjectConsumerLayer, deps={"obj": "obj"}),
        ]
    )

    async def run() -> None:
        async with compositor.enter(configs={"prompt": {"prefix": "cfg"}}) as active_run:
            assert [prompt.value for prompt in active_run.prompts] == ["cfg", "instance"]

    asyncio.run(run())


class SerializableState(BaseModel):
    resource_id: str = ""
    created: bool = False
    resumed: bool = False

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


@dataclass(slots=True)
class StateLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, SerializableState]):
    created_hooks: int = 0
    resumed_hooks: int = 0

    @override
    async def on_context_create(self) -> None:
        self.created_hooks += 1
        self.runtime_state.created = True

    @override
    async def on_context_resume(self) -> None:
        self.resumed_hooks += 1
        self.runtime_state.resumed = True


def test_snapshot_contains_runtime_state_only_not_config_deps_or_resources() -> None:
    compositor = Compositor([LayerNode("state", StateLayer)])

    async def get_snapshot() -> dict[str, object]:
        async with compositor.enter() as active_run:
            state_layer = active_run.get_layer("state", StateLayer)
            state_layer.runtime_state.resource_id = "abc"
        assert active_run.session_snapshot is not None
        return active_run.session_snapshot.model_dump(mode="json")

    dumped = asyncio.run(get_snapshot())
    assert dumped == {
        "schema_version": 1,
        "layers": [
            {
                "name": "state",
                "lifecycle_state": "closed",
                "runtime_state": {"resource_id": "abc", "created": True, "resumed": False},
            }
        ],
    }


def test_hydrate_validates_runtime_state_and_resume_mutates_layer_self() -> None:
    compositor = Compositor([LayerNode("state", StateLayer)])

    bad_snapshot = {"layers": [{"name": "state", "lifecycle_state": "suspended", "runtime_state": {"wrong": "field"}}]}
    with pytest.raises(ValidationError):
        asyncio.run(_enter_once(compositor, session_snapshot=bad_snapshot))

    good_snapshot = {
        "layers": [
            {
                "name": "state",
                "lifecycle_state": "suspended",
                "runtime_state": {"resource_id": "abc", "created": True, "resumed": False},
            }
        ]
    }

    async def run() -> None:
        async with compositor.enter(session_snapshot=good_snapshot) as active_run:
            layer = active_run.get_layer("state", StateLayer)
            assert layer.runtime_state.resource_id == "abc"
            assert layer.runtime_state.resumed is True
            assert layer.resumed_hooks == 1

    asyncio.run(run())


def test_hydrate_rejects_mismatched_snapshot_layer_names() -> None:
    compositor = Compositor([LayerNode("state", StateLayer)])

    with pytest.raises(ValueError, match=r"Expected \[state\], got \[other\]"):
        asyncio.run(
            _enter_once(
                compositor,
                session_snapshot={"layers": [{"name": "other", "lifecycle_state": "new", "runtime_state": {}}]},
            )
        )


def test_removed_lifecycle_and_resource_apis_are_not_public_exports() -> None:
    assert not hasattr(compositor_module, "CompositorBuilder")
    assert not hasattr(compositor_module, "LayerRegistry")
    assert not hasattr(compositor_module, "LayerDescriptor")
    assert not hasattr(layers_module, "LayerControl")
    assert not hasattr(layers_module, "EmptyRuntimeHandles")
    assert not hasattr(Layer, "enter")
    assert not hasattr(Layer, "hydrate_session_state")
    assert not hasattr(Layer, "suspend_on_exit")
    assert not hasattr(Layer, "delete_on_exit")
    assert not hasattr(Layer, "runtime_handles")
    assert not hasattr(Layer, "require_control")
    assert not hasattr(Layer, "control_for")
    assert not hasattr(Layer, "enter_async_resource")
    assert not hasattr(Layer, "add_async_cleanup")


def test_facade_keeps_direct_import_type_aliases_without_expanding___all__() -> None:
    assert compositor_module.LayerConfigInput is LayerConfigInput
    assert compositor_module.LayerProviderInput is LayerProviderInput
    assert LayerConfigInput.__module__ == "agenton.compositor"
    assert LayerProviderInput.__module__ == "agenton.compositor"
    assert LayerConfigInput.__name__ == "LayerConfigInput"
    assert LayerProviderInput.__name__ == "LayerProviderInput"
    assert "LayerConfigInput" not in compositor_module.__all__
    assert "LayerProviderInput" not in compositor_module.__all__


def test_facade_export_surface_matches_split_contract() -> None:
    compatibility_names = [*EXPECTED_FACADE_EXPORTS, *EXPECTED_DIRECT_IMPORT_COMPAT_NAMES]

    assert compositor_module.__all__ == EXPECTED_FACADE_EXPORTS

    namespace: dict[str, object] = {}
    exec(
        "from agenton.compositor import " + ", ".join(compatibility_names),
        {},
        namespace,
    )

    for name in compatibility_names:
        assert namespace[name] is getattr(compositor_module, name)


def _object_provider(value: str) -> LayerProvider[ObjectLayer[str]]:
    return LayerProvider.from_factory(layer_type=ObjectLayer, create=lambda config: ObjectLayer(value))


async def _enter_once(
    compositor: Compositor,
    *,
    configs: dict[str, object] | None = None,
    session_snapshot: object | None = None,
) -> None:
    async with compositor.enter(
        configs=configs,  # pyright: ignore[reportArgumentType]
        session_snapshot=session_snapshot,  # pyright: ignore[reportArgumentType]
    ):
        pass
