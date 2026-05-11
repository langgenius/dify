import asyncio
from collections import OrderedDict
from dataclasses import dataclass

import pytest
from typing_extensions import override

from agenton.compositor import Compositor, CompositorSession
from agenton.layers import LayerControl, LayerDeps, PlainLayer, PlainPromptType, PlainToolType
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
    pass


class DoubleObjectDeps(LayerDeps):
    first: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]
    second: ObjectLayer[str]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DoubleConsumerLayer(PlainLayer[DoubleObjectDeps]):
    pass


class OptionalObjectDeps(LayerDeps):
    maybe: ObjectLayer[str] | None  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class OptionalConsumerLayer(PlainLayer[OptionalObjectDeps]):
    pass


def test_control_for_layer_resolves_unique_explicit_dependency_rename() -> None:
    target = ObjectLayer("target")
    consumer = RenamedConsumerLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("actual", target), ("consumer", consumer)]),
        deps_name_mapping={"consumer": {"renamed": "actual"}},
    )
    session = compositor.new_session()

    resolved = session.layer("consumer").control_for(target)

    assert resolved is session.layer("actual")
    assert consumer.prefix_prompts == ["target"]


def test_control_for_layer_resolves_unique_implicit_same_name_dependency() -> None:
    target = ObjectLayer("target")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("same", target), ("consumer", SameNameConsumerLayer())]),
    )
    session = compositor.new_session()

    assert session.layer("consumer").control_for(target) is session.layer("same")


def test_control_for_layer_raises_when_no_dependency_points_to_layer() -> None:
    target = ObjectLayer("target")
    unrelated = ObjectLayer("unrelated")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("target", target), ("unrelated", unrelated), ("consumer", RenamedConsumerLayer())]),
        deps_name_mapping={"consumer": {"renamed": "target"}},
    )
    session = compositor.new_session()

    with pytest.raises(KeyError, match="no dependency target.*provided ObjectLayer instance"):
        _ = session.layer("consumer").control_for(unrelated)


def test_control_for_layer_raises_when_multiple_dependency_fields_match() -> None:
    target = ObjectLayer("target")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("target", target), ("consumer", DoubleConsumerLayer())]),
        deps_name_mapping={"consumer": {"first": "target", "second": "target"}},
    )
    session = compositor.new_session()

    with pytest.raises(ValueError, match="multiple dependency fields.*Pass dep_name explicitly"):
        _ = session.layer("consumer").control_for(target)


def test_control_for_explicit_dep_name_disambiguates_multiple_deps() -> None:
    target = ObjectLayer("target")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("target", target), ("consumer", DoubleConsumerLayer())]),
        deps_name_mapping={"consumer": {"first": "target", "second": "target"}},
    )
    session = compositor.new_session()

    assert session.layer("consumer").control_for("second", target) is session.layer("target")


def test_control_for_optional_missing_dependency_raises() -> None:
    target = ObjectLayer("target")
    consumer = OptionalConsumerLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("consumer", consumer)]),
    )
    session = compositor.new_session()

    assert consumer.deps.maybe is None
    with pytest.raises(KeyError, match="dependency 'maybe' is not bound"):
        _ = session.layer("consumer").control_for("maybe", target)


def test_restored_session_rebinds_owner_links_for_control_for() -> None:
    target = ObjectLayer("target")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("actual", target), ("consumer", RenamedConsumerLayer())]),
        deps_name_mapping={"consumer": {"renamed": "actual"}},
    )
    session = compositor.new_session()

    async def suspend_session() -> None:
        async with compositor.enter(session) as active_session:
            active_session.suspend_on_exit()

    asyncio.run(suspend_session())
    restored = compositor.session_from_snapshot(compositor.snapshot_session(session))

    assert restored.layer("consumer").control_for(target) is restored.layer("actual")


def test_enter_rebinds_external_session_owner_links_for_control_for() -> None:
    target = ObjectLayer("target")
    consumer = RenamedConsumerLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("actual", target), ("consumer", consumer)]),
        deps_name_mapping={"consumer": {"renamed": "actual"}},
    )
    external_session = CompositorSession(
        OrderedDict([("actual", target.new_control()), ("consumer", consumer.new_control())])
    )

    async def enter_session() -> None:
        async with compositor.enter(external_session) as active_session:
            assert active_session.layer("consumer").control_for(target) is active_session.layer("actual")

    asyncio.run(enter_session())


def test_failed_enter_does_not_rebind_active_session_owner_links() -> None:
    first_target = ObjectLayer("first")
    second_target = ObjectLayer("second")
    first_compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("actual", first_target), ("consumer", RenamedConsumerLayer())]),
        deps_name_mapping={"consumer": {"renamed": "actual"}},
    )
    second_compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("actual", second_target), ("consumer", RenamedConsumerLayer())]),
        deps_name_mapping={"consumer": {"renamed": "actual"}},
    )
    session = first_compositor.new_session()

    async def enter_conflicting_compositor() -> None:
        async with first_compositor.enter(session) as active_session:
            with pytest.raises(RuntimeError, match="already active"):
                async with second_compositor.enter(active_session):
                    raise AssertionError("Expected active-session rejection before entering layers.")

            assert active_session.layer("consumer").control_for(first_target) is active_session.layer("actual")

    asyncio.run(enter_conflicting_compositor())


def test_control_for_uses_owner_resolved_targets_not_graph_wide_object_identity() -> None:
    shared_target = ObjectLayer("shared")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict(
            [
                ("first-id", shared_target),
                ("second-id", shared_target),
                ("consumer", RenamedConsumerLayer()),
            ]
        ),
        deps_name_mapping={"consumer": {"renamed": "second-id"}},
    )
    session = compositor.new_session()

    resolved = session.layer("consumer").control_for(shared_target)

    assert resolved is session.layer("second-id")
    assert resolved is not session.layer("first-id")


def test_control_for_explicit_dep_name_rejects_wrong_layer_instance() -> None:
    target = ObjectLayer("target")
    wrong = ObjectLayer("wrong")
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("target", target), ("wrong", wrong), ("consumer", RenamedConsumerLayer())]),
        deps_name_mapping={"consumer": {"renamed": "target"}},
    )
    session = compositor.new_session()

    with pytest.raises(TypeError, match="dependency 'renamed'.*not the provided ObjectLayer instance"):
        _ = session.layer("consumer").control_for("renamed", wrong)


def test_control_for_unowned_control_raises_clear_error() -> None:
    with pytest.raises(RuntimeError, match="not attached to a compositor session"):
        _ = LayerControl().control_for(ObjectLayer("target"))
