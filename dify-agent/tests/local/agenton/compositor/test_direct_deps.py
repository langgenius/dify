import asyncio
from dataclasses import dataclass

import pytest
from typing_extensions import override

from agenton.compositor import Compositor, LayerNode, LayerProvider
from agenton.layers import EmptyLayerConfig, LayerDeps, PlainLayer
from agenton_collections.layers.plain import ObjectLayer


class RenamedObjectDeps(LayerDeps):
    renamed: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class RenamedConsumerLayer(PlainLayer[RenamedObjectDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.deps.renamed.value]


class SameNameObjectDeps(LayerDeps):
    same: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class SameNameConsumerLayer(PlainLayer[SameNameObjectDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.deps.same.value]


class OptionalObjectDeps(LayerDeps):
    maybe: ObjectLayer[str] | None  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class OptionalConsumerLayer(PlainLayer[OptionalObjectDeps]):
    pass


def _object_provider(value: str) -> LayerProvider[ObjectLayer[str]]:
    return LayerProvider.from_factory(
        layer_type=ObjectLayer,
        create=lambda config: ObjectLayer(value),
    )


def test_direct_deps_access_uses_explicit_dependency_rename() -> None:
    compositor = Compositor(
        [
            LayerNode("actual", _object_provider("target")),
            LayerNode("consumer", RenamedConsumerLayer, deps={"renamed": "actual"}),
        ]
    )

    async def run() -> None:
        async with compositor.enter() as active_run:
            target = active_run.get_layer("actual", ObjectLayer)
            consumer = active_run.get_layer("consumer", RenamedConsumerLayer)
            assert consumer.deps.renamed is target
            assert [prompt.value for prompt in active_run.prompts] == ["target"]

    asyncio.run(run())


def test_direct_deps_access_uses_explicit_same_name_dependency() -> None:
    compositor = Compositor(
        [
            LayerNode("same", _object_provider("target")),
            LayerNode("consumer", SameNameConsumerLayer, deps={"same": "same"}),
        ]
    )

    async def run() -> None:
        async with compositor.enter() as active_run:
            target = active_run.get_layer("same", ObjectLayer)
            consumer = active_run.get_layer("consumer", SameNameConsumerLayer)
            assert consumer.deps.same is target
            assert [prompt.value for prompt in active_run.prompts] == ["target"]

    asyncio.run(run())


def test_optional_missing_dependency_is_bound_to_none() -> None:
    compositor = Compositor([LayerNode("consumer", OptionalConsumerLayer)])

    async def run() -> None:
        async with compositor.enter() as active_run:
            consumer = active_run.get_layer("consumer", OptionalConsumerLayer)
            assert consumer.deps.maybe is None

    asyncio.run(run())


def test_missing_required_dependency_is_rejected_before_hooks() -> None:
    compositor = Compositor([LayerNode("consumer", SameNameConsumerLayer)])

    with pytest.raises(ValueError, match="Dependency 'same' is required"):
        asyncio.run(_enter_once(compositor))


def test_unknown_dependency_mapping_is_rejected_for_compositor_construction() -> None:
    with pytest.raises(ValueError, match="unknown dependency keys: missing"):
        Compositor([LayerNode("consumer", RenamedConsumerLayer, deps={"missing": "target"})])


def test_undefined_dependency_target_is_rejected_for_compositor_construction() -> None:
    with pytest.raises(ValueError, match="depends on undefined layer names: missing_target"):
        Compositor([LayerNode("consumer", RenamedConsumerLayer, deps={"renamed": "missing_target"})])


def test_duplicate_layer_node_name_is_rejected() -> None:
    with pytest.raises(ValueError, match="Duplicate layer name 'same'"):
        Compositor(
            [
                LayerNode("same", _object_provider("first")),
                LayerNode("same", _object_provider("second")),
            ]
        )


async def _enter_once(compositor: Compositor) -> None:
    async with compositor.enter(configs={"consumer": EmptyLayerConfig()}):
        pass
