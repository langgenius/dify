import asyncio
from collections.abc import Iterator
from dataclasses import dataclass, field
from itertools import count

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError
from typing_extensions import override

from agenton.compositor import Compositor, CompositorSessionSnapshot, LayerNode, LayerProvider
from agenton.layers import (
    EmptyLayerConfig,
    ExitIntent,
    LayerConfig,
    LifecycleState,
    NoLayerDeps,
    PlainLayer,
)


@dataclass(slots=True)
class TraceLayer(PlainLayer[NoLayerDeps]):
    """Layer that records no-arg lifecycle events observable to tests."""

    events: list[str] = field(default_factory=list)

    @override
    async def on_context_create(self) -> None:
        self.events.append("create")

    @override
    async def on_context_suspend(self) -> None:
        self.events.append("suspend")

    @override
    async def on_context_resume(self) -> None:
        self.events.append("resume")

    @override
    async def on_context_delete(self) -> None:
        self.events.append("delete")


def _compositor(*layer_names: str) -> Compositor:
    return Compositor([LayerNode(layer_name, TraceLayer) for layer_name in layer_names])


def test_same_compositor_enters_multiple_times_with_fresh_layers_and_snapshot_resume() -> None:
    compositor = _compositor("first", "second")
    runs = []

    async def run() -> None:
        async with compositor.enter() as first_run:
            assert [slot.lifecycle_state for slot in first_run.slots.values()] == [
                LifecycleState.ACTIVE,
                LifecycleState.ACTIVE,
            ]
            first_run.suspend_on_exit()
            assert [slot.exit_intent for slot in first_run.slots.values()] == [
                ExitIntent.SUSPEND,
                ExitIntent.SUSPEND,
            ]
        runs.append(first_run)

        assert first_run.session_snapshot is not None
        async with compositor.enter(session_snapshot=first_run.session_snapshot) as resumed_run:
            assert resumed_run.get_layer("first", TraceLayer).events == ["resume"]
            assert resumed_run.get_layer("second", TraceLayer).events == ["resume"]
        runs.append(resumed_run)

    asyncio.run(run())

    first_layer = runs[0].get_layer("first", TraceLayer)
    resumed_layer = runs[1].get_layer("first", TraceLayer)
    assert first_layer is not resumed_layer
    assert first_layer.events == ["create", "suspend"]
    assert resumed_layer.events == ["resume", "delete"]
    assert runs[1].session_snapshot is not None
    assert [layer.lifecycle_state for layer in runs[1].session_snapshot.layers] == [
        LifecycleState.CLOSED,
        LifecycleState.CLOSED,
    ]


def test_concurrent_enters_do_not_share_layer_instances() -> None:
    compositor = _compositor("trace")

    async def enter_once() -> tuple[int, list[str]]:
        async with compositor.enter() as run:
            layer = run.get_layer("trace", TraceLayer)
            await asyncio.sleep(0)
        return id(layer), layer.events

    async def run_concurrently() -> list[tuple[int, list[str]]]:
        return list(await asyncio.gather(enter_once(), enter_once()))

    results = asyncio.run(run_concurrently())

    assert results[0][0] != results[1][0]
    assert results[0][1] == ["create", "delete"]
    assert results[1][1] == ["create", "delete"]


class ConfiguredLayerConfig(LayerConfig):
    value: str

    model_config = ConfigDict(extra="forbid")


@dataclass(slots=True)
class ConfiguredLayer(PlainLayer[NoLayerDeps, ConfiguredLayerConfig]):
    type_id = "test.configured"

    value: str

    hooks: list[str] = field(default_factory=list)

    @classmethod
    @override
    def from_config(cls, config: ConfiguredLayerConfig) -> "ConfiguredLayer":
        return cls(value=config.value)

    @override
    async def on_context_create(self) -> None:
        self.hooks.append(f"create:{self.config.value}")


def test_custom_factory_is_called_each_enter_with_typed_config() -> None:
    calls: list[str] = []

    def create_layer(config: ConfiguredLayerConfig) -> ConfiguredLayer:
        calls.append(config.value)
        return ConfiguredLayer(value=f"factory:{config.value}")

    compositor = Compositor(
        [LayerNode("configured", LayerProvider.from_factory(layer_type=ConfiguredLayer, create=create_layer))]
    )

    async def run() -> None:
        async with compositor.enter(configs={"configured": {"value": "one"}}) as first_run:
            first_layer = first_run.get_layer("configured", ConfiguredLayer)
            assert first_layer.value == "factory:one"
            assert first_layer.config.value == "one"
        async with compositor.enter(configs={"configured": ConfiguredLayerConfig(value="two")}) as second_run:
            second_layer = second_run.get_layer("configured", ConfiguredLayer)
            assert second_layer.value == "factory:two"
            assert second_layer.config.value == "two"
            assert second_layer is not first_layer

    asyncio.run(run())

    assert calls == ["one", "two"]


def test_provider_rejects_reused_layer_instance_before_hooks_run() -> None:
    shared_layer = TraceLayer()
    compositor = Compositor(
        [
            LayerNode(
                "trace",
                LayerProvider.from_factory(layer_type=TraceLayer, create=lambda config: shared_layer),
            )
        ]
    )

    async def run() -> None:
        async with compositor.enter():
            pass

        with pytest.raises(ValueError, match="fresh layer instance"):
            async with compositor.enter():
                pass

    asyncio.run(run())

    assert shared_layer.events == ["create", "delete"]


def test_configs_are_validated_by_node_name_before_factory_call() -> None:
    calls: list[str] = []

    def create_layer(config: ConfiguredLayerConfig) -> ConfiguredLayer:
        calls.append(config.value)
        return ConfiguredLayer(value=config.value)

    compositor = Compositor(
        [LayerNode("configured", LayerProvider.from_factory(layer_type=ConfiguredLayer, create=create_layer))]
    )

    with pytest.raises(ValueError, match="unknown layer node names: missing"):
        asyncio.run(_enter_once(compositor, configs={"missing": {}}))

    with pytest.raises(ValidationError):
        asyncio.run(_enter_once(compositor, configs={"configured": {"unknown": "field"}}))

    assert calls == []


def test_all_node_configs_are_validated_before_any_factory_runs() -> None:
    calls: list[str] = []

    def create_layer(config: ConfiguredLayerConfig) -> ConfiguredLayer:
        calls.append(config.value)
        return ConfiguredLayer(value=config.value)

    provider = LayerProvider.from_factory(layer_type=ConfiguredLayer, create=create_layer)
    compositor = Compositor([LayerNode("first", provider), LayerNode("second", provider)])

    with pytest.raises(ValidationError):
        asyncio.run(
            _enter_once(
                compositor,
                configs={"first": {"value": "valid"}, "second": {"unknown": "field"}},
            )
        )

    assert calls == []


def test_existing_config_model_instances_are_revalidated_before_factory_runs() -> None:
    calls: list[str] = []

    def create_layer(config: ConfiguredLayerConfig) -> ConfiguredLayer:
        calls.append(config.value)
        return ConfiguredLayer(value=config.value)

    compositor = Compositor(
        [LayerNode("configured", LayerProvider.from_factory(layer_type=ConfiguredLayer, create=create_layer))]
    )
    config = ConfiguredLayerConfig(value="valid")
    config.value = 123  # pyright: ignore[reportAttributeAccessIssue]

    with pytest.raises(ValidationError):
        asyncio.run(_enter_once(compositor, configs={"configured": config}))

    assert calls == []


def test_existing_snapshot_model_instances_are_revalidated_before_factory_runs() -> None:
    calls = 0

    def create_layer(config: EmptyLayerConfig) -> TraceLayer:
        nonlocal calls
        calls += 1
        return TraceLayer()

    compositor = Compositor(
        [LayerNode("trace", LayerProvider.from_factory(layer_type=TraceLayer, create=create_layer))]
    )
    snapshot = CompositorSessionSnapshot.model_validate(
        {"layers": [{"name": "trace", "lifecycle_state": "suspended", "runtime_state": {}}]}
    )
    snapshot.layers[0].lifecycle_state = LifecycleState.ACTIVE

    with pytest.raises(ValidationError, match="ACTIVE is internal-only"):
        asyncio.run(_enter_once(compositor, session_snapshot=snapshot))

    assert calls == 0


class RuntimeState(BaseModel):
    runtime_id: int | None = None
    resumed_runtime_id: int | None = None
    deleted_runtime_id: int | None = None
    body_value: str | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


@dataclass(slots=True)
class RuntimeStateLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, RuntimeState]):
    next_id: Iterator[int] = field(default_factory=lambda: count(1))

    @override
    async def on_context_create(self) -> None:
        self.runtime_state.runtime_id = next(self.next_id)

    @override
    async def on_context_resume(self) -> None:
        self.runtime_state.resumed_runtime_id = self.runtime_state.runtime_id

    @override
    async def on_context_delete(self) -> None:
        self.runtime_state.deleted_runtime_id = self.runtime_state.runtime_id


def test_snapshot_hydrates_runtime_state_and_exit_snapshots_from_layer_self() -> None:
    compositor = Compositor([LayerNode("state", RuntimeStateLayer)])

    async def create_suspend_resume_delete() -> tuple[CompositorSessionSnapshot, CompositorSessionSnapshot]:
        async with compositor.enter() as first_run:
            first_run.suspend_on_exit()
        assert first_run.session_snapshot is not None

        async with compositor.enter(session_snapshot=first_run.session_snapshot) as resumed_run:
            resumed_layer = resumed_run.get_layer("state", RuntimeStateLayer)
            assert isinstance(resumed_layer.runtime_state, RuntimeState)
            assert resumed_layer.runtime_state.runtime_id == 1
            assert resumed_layer.runtime_state.resumed_runtime_id == 1
            resumed_layer.runtime_state.body_value = "mutated on self"
        assert resumed_run.session_snapshot is not None
        return first_run.session_snapshot, resumed_run.session_snapshot

    suspended_snapshot, closed_snapshot = asyncio.run(create_suspend_resume_delete())

    assert suspended_snapshot.model_dump(mode="json") == {
        "schema_version": 1,
        "layers": [
            {
                "name": "state",
                "lifecycle_state": "suspended",
                "runtime_state": {
                    "runtime_id": 1,
                    "resumed_runtime_id": None,
                    "deleted_runtime_id": None,
                    "body_value": None,
                },
            }
        ],
    }
    assert closed_snapshot.model_dump(mode="json") == {
        "schema_version": 1,
        "layers": [
            {
                "name": "state",
                "lifecycle_state": "closed",
                "runtime_state": {
                    "runtime_id": 1,
                    "resumed_runtime_id": 1,
                    "deleted_runtime_id": 1,
                    "body_value": "mutated on self",
                },
            }
        ],
    }


def test_run_snapshot_rejects_active_layers() -> None:
    compositor = _compositor("trace")

    async def run() -> None:
        async with compositor.enter() as active_run:
            with pytest.raises(RuntimeError, match="Cannot snapshot active compositor run layers: trace"):
                active_run.snapshot_session()

    asyncio.run(run())


def test_active_snapshot_input_is_rejected_before_factories_run() -> None:
    calls = 0

    def create_layer(config: EmptyLayerConfig) -> TraceLayer:
        nonlocal calls
        calls += 1
        return TraceLayer()

    compositor = Compositor(
        [LayerNode("trace", LayerProvider.from_factory(layer_type=TraceLayer, create=create_layer))]
    )
    active_snapshot = {"layers": [{"name": "trace", "lifecycle_state": "active", "runtime_state": {}}]}

    with pytest.raises(ValidationError, match="ACTIVE is internal-only"):
        CompositorSessionSnapshot.model_validate(active_snapshot)

    with pytest.raises(ValidationError, match="ACTIVE is internal-only"):
        asyncio.run(_enter_once(compositor, session_snapshot=active_snapshot))

    assert calls == 0


def test_closed_snapshot_enter_is_rejected_before_hooks_run() -> None:
    created_layers: list[TraceLayer] = []

    def create_layer(config: EmptyLayerConfig) -> TraceLayer:
        layer = TraceLayer()
        created_layers.append(layer)
        return layer

    compositor = Compositor(
        [LayerNode("trace", LayerProvider.from_factory(layer_type=TraceLayer, create=create_layer))]
    )
    closed_snapshot = {"layers": [{"name": "trace", "lifecycle_state": "closed", "runtime_state": {}}]}

    with pytest.raises(RuntimeError, match="CLOSED snapshots cannot be entered"):
        asyncio.run(_enter_once(compositor, session_snapshot=closed_snapshot))

    assert len(created_layers) == 1
    assert created_layers[0].events == []


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
