import asyncio
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass, field
from itertools import count

from typing_extensions import override

from agenton.compositor import Compositor, CompositorSession
from agenton.layers import (
    ExitIntent,
    LayerControl,
    LifecycleState,
    NoLayerDeps,
    PlainLayer,
    PlainPromptType,
    PlainToolType,
)


@dataclass(slots=True)
class TraceLayer(PlainLayer[NoLayerDeps]):
    """Layer that records lifecycle events observable to tests."""

    events: list[str] = field(default_factory=list)

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        self.events.append("create")

    @override
    async def on_context_suspend(self, control: LayerControl) -> None:
        self.events.append("suspend")

    @override
    async def on_context_resume(self, control: LayerControl) -> None:
        self.events.append("resume")

    @override
    async def on_context_delete(self, control: LayerControl) -> None:
        self.events.append("delete")


def _compositor(*layer_names: str) -> tuple[Compositor[PlainPromptType, PlainToolType], dict[str, TraceLayer]]:
    layers = {layer_name: TraceLayer() for layer_name in layer_names}
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict(layers.items()))
    return compositor, layers


def test_compositor_session_suspends_resumes_and_deletes_all_layers() -> None:
    compositor, layers = _compositor("first", "second")
    session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(session) as active_session:
            assert active_session is session
            assert list(active_session.layer_controls) == ["first", "second"]
            active_session.suspend_on_exit()
            assert active_session.layer("first").exit_intent is ExitIntent.SUSPEND

        assert session.layer("first").state is LifecycleState.SUSPENDED

        async with compositor.enter(session):
            pass

    asyncio.run(run())

    assert layers["first"].events == ["create", "suspend", "resume", "delete"]
    assert layers["second"].events == ["create", "suspend", "resume", "delete"]
    assert session.layer("first").state is LifecycleState.CLOSED


def test_compositor_enter_without_session_uses_fresh_lifecycle_each_time() -> None:
    compositor, layers = _compositor("trace")

    async def run() -> None:
        async with compositor.enter() as session:
            session.suspend_on_exit()

        async with compositor.enter():
            pass

    asyncio.run(run())

    assert layers["trace"].events == ["create", "suspend", "create", "delete"]


def test_compositor_enter_rejects_session_with_mismatched_layer_names() -> None:
    compositor, _layers = _compositor("trace")
    session = CompositorSession(["other"])

    async def run() -> None:
        async with compositor.enter(session):
            pass

    try:
        asyncio.run(run())
    except ValueError as e:
        assert str(e) == (
            "CompositorSession layer names must match compositor layers in order. "
            "Expected [trace], got [other]."
        )
    else:
        raise AssertionError("Expected ValueError.")


def test_compositor_enter_rejects_same_active_session_nested() -> None:
    compositor, _layers = _compositor("trace")
    session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(session):
            async with compositor.enter(session):
                pass

    try:
        asyncio.run(run())
    except RuntimeError as e:
        assert str(e) == "LayerControl is already active; duplicate or nested enter is not allowed."
    else:
        raise AssertionError("Expected RuntimeError.")


def test_compositor_enter_rejects_closed_session() -> None:
    compositor, _layers = _compositor("trace")
    session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(session):
            pass

        async with compositor.enter(session):
            pass

    try:
        asyncio.run(run())
    except RuntimeError as e:
        assert str(e) == "LayerControl is closed; create a new compositor session before entering again."
    else:
        raise AssertionError("Expected RuntimeError.")


def test_per_layer_suspend_on_exit_only_resumes_that_layer() -> None:
    compositor, layers = _compositor("first", "second")
    session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(session):
            session.layer("first").suspend_on_exit()

        assert session.layer("first").state is LifecycleState.SUSPENDED
        assert session.layer("second").state is LifecycleState.CLOSED

        async with compositor.enter(session):
            pass

    try:
        asyncio.run(run())
    except RuntimeError as e:
        assert str(e) == "LayerControl is closed; create a new compositor session before entering again."
    else:
        raise AssertionError("Expected RuntimeError.")

    assert layers["first"].events == ["create", "suspend"]
    assert layers["second"].events == ["create", "delete"]


@dataclass(slots=True)
class FailingCreateLayer(PlainLayer[NoLayerDeps]):
    attempts: int = 0

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("create failed")


def test_failed_create_keeps_control_reusable_as_new() -> None:
    layer = FailingCreateLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("trace", layer)]))
    session = compositor.new_session()

    async def fail_then_retry() -> None:
        try:
            async with compositor.enter(session):
                pass
        except RuntimeError as e:
            assert str(e) == "create failed"
        else:
            raise AssertionError("Expected RuntimeError.")

        assert session.layer("trace").state is LifecycleState.NEW

        async with compositor.enter(session):
            pass

    asyncio.run(fail_then_retry())

    assert session.layer("trace").state is LifecycleState.CLOSED
    assert layer.attempts == 2


@dataclass(slots=True)
class FailingResumeLayer(PlainLayer[NoLayerDeps]):
    resumed: bool = False

    @override
    async def on_context_resume(self, control: LayerControl) -> None:
        if not self.resumed:
            self.resumed = True
            raise RuntimeError("resume failed")


def test_failed_resume_keeps_control_reusable_as_suspended() -> None:
    layer = FailingResumeLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("trace", layer)]))
    session = compositor.new_session()

    async def suspend_fail_then_retry() -> None:
        async with compositor.enter(session) as active_session:
            active_session.suspend_on_exit()

        try:
            async with compositor.enter(session):
                pass
        except RuntimeError as e:
            assert str(e) == "resume failed"
        else:
            raise AssertionError("Expected RuntimeError.")

        assert session.layer("trace").state is LifecycleState.SUSPENDED

        async with compositor.enter(session):
            pass

    asyncio.run(suspend_fail_then_retry())

    assert session.layer("trace").state is LifecycleState.CLOSED


@dataclass(slots=True)
class RuntimeStateLayer(PlainLayer[NoLayerDeps]):
    next_id: Iterator[int] = field(default_factory=lambda: count(1))

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        runtime_id = next(self.next_id)
        control.runtime_state["runtime_id"] = runtime_id

    @override
    async def on_context_resume(self, control: LayerControl) -> None:
        control.runtime_state["resumed_runtime_id"] = control.runtime_state["runtime_id"]

    @override
    async def on_context_delete(self, control: LayerControl) -> None:
        control.runtime_state["deleted_runtime_id"] = control.runtime_state["runtime_id"]


def test_runtime_state_is_per_session_and_survives_suspend_resume_delete() -> None:
    layer = RuntimeStateLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("trace", layer)]))
    first_session = compositor.new_session()
    second_session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(first_session) as active_session:
            active_session.suspend_on_exit()

        async with compositor.enter(second_session):
            pass

        async with compositor.enter(first_session):
            pass

    asyncio.run(run())

    assert first_session.layer("trace").runtime_state == {
        "runtime_id": 1,
        "resumed_runtime_id": 1,
        "deleted_runtime_id": 1,
    }
    assert second_session.layer("trace").runtime_state == {
        "runtime_id": 2,
        "deleted_runtime_id": 2,
    }
    assert not hasattr(layer, "runtime_id")
