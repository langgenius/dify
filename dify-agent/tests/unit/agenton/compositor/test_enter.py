import asyncio
from collections import OrderedDict
from dataclasses import dataclass, field

from typing_extensions import override

from agenton.compositor import Compositor, CompositorControl
from agenton.layers import LayerControl, NoLayerDeps, PlainLayer, PlainPromptType, PlainToolType


@dataclass(slots=True)
class TraceLayer(PlainLayer[NoLayerDeps]):
    """Layer that records lifecycle events observable to tests."""

    events: list[str] = field(default_factory=list)

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        self.events.append("create")

    @override
    async def on_context_tmp_leave(self, control: LayerControl) -> None:
        self.events.append("tmp_leave")

    @override
    async def on_context_reenter(self, control: LayerControl) -> None:
        self.events.append("reenter")

    @override
    async def on_context_delete(self, control: LayerControl) -> None:
        self.events.append("delete")


def test_compositor_enter_creates_control_and_applies_tmp_leave_to_all_layers() -> None:
    first_layer = TraceLayer()
    second_layer = TraceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict(
            [
                ("first", first_layer),
                ("second", second_layer),
            ]
        )
    )
    compositor_control = CompositorControl(compositor.layers)

    async def run() -> None:
        async with compositor.enter(compositor_control) as control:
            assert control is compositor_control
            assert list(control.layer_controls) == ["first", "second"]
            control.tmp_leave = True

        async with compositor.enter(compositor_control):
            pass

    asyncio.run(run())

    assert first_layer.events == ["create", "tmp_leave", "reenter", "delete"]
    assert second_layer.events == ["create", "tmp_leave", "reenter", "delete"]


def test_compositor_enter_does_not_store_tmp_leave_on_layer() -> None:
    layer = TraceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("trace", layer)])
    )

    async def run() -> None:
        async with compositor.enter() as control:
            control.tmp_leave = True

        async with compositor.enter():
            pass

    asyncio.run(run())

    assert layer.events == ["create", "tmp_leave", "create", "delete"]


def test_compositor_enter_rejects_control_with_mismatched_layer_names() -> None:
    layer = TraceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("trace", layer)])
    )
    compositor_control = CompositorControl(["other"])

    async def run() -> None:
        async with compositor.enter(compositor_control):
            pass

    try:
        asyncio.run(run())
    except ValueError as e:
        assert str(e) == (
            "CompositorControl layer names must match compositor layers in order. "
            "Expected [trace], got [other]."
        )
    else:
        raise AssertionError("Expected ValueError.")
