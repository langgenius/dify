import asyncio
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass, field
from itertools import count
from typing import cast

import pytest
from pydantic import BaseModel, ConfigDict
from typing_extensions import override

from agenton.compositor import Compositor, CompositorSession
from agenton.layers import (
    ExitIntent,
    EmptyLayerConfig,
    EmptyRuntimeHandles,
    EmptyRuntimeState,
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


class RuntimeState(BaseModel):
    runtime_id: int | None = None
    resumed_runtime_id: int | None = None
    deleted_runtime_id: int | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


@dataclass(slots=True)
class RuntimeStateLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, RuntimeState]):
    next_id: Iterator[int] = field(default_factory=lambda: count(1))

    @override
    async def on_context_create(self, control: LayerControl[RuntimeState, EmptyRuntimeHandles]) -> None:
        runtime_id = next(self.next_id)
        control.runtime_state.runtime_id = runtime_id

    @override
    async def on_context_resume(self, control: LayerControl[RuntimeState, EmptyRuntimeHandles]) -> None:
        control.runtime_state.resumed_runtime_id = control.runtime_state.runtime_id

    @override
    async def on_context_delete(self, control: LayerControl[RuntimeState, EmptyRuntimeHandles]) -> None:
        control.runtime_state.deleted_runtime_id = control.runtime_state.runtime_id


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

    assert first_session.layer("trace").runtime_state.model_dump(exclude_none=True) == {
        "runtime_id": 1,
        "resumed_runtime_id": 1,
        "deleted_runtime_id": 1,
    }
    assert second_session.layer("trace").runtime_state.model_dump(exclude_none=True) == {
        "runtime_id": 2,
        "deleted_runtime_id": 2,
    }
    assert not hasattr(layer, "runtime_id")


class ResourceHandles(BaseModel):
    resource: "RecordingResource | None" = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


class RecordingResource:
    events: list[str]
    label: str
    closed: bool

    def __init__(self, events: list[str], label: str) -> None:
        self.events = events
        self.label = label
        self.closed = False

    async def __aenter__(self) -> "RecordingResource":
        self.events.append(f"enter:{self.label}")
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.closed = True
        self.events.append(f"exit:{self.label}")


@dataclass(slots=True)
class ResourceLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, EmptyRuntimeState, ResourceHandles]):
    events: list[str] = field(default_factory=list)
    resources: list[RecordingResource] = field(default_factory=list)
    fail_create: bool = False
    fail_resume: bool = False
    fail_suspend: bool = False
    fail_delete: bool = False

    @override
    async def on_context_create(self, control: LayerControl[EmptyRuntimeState, ResourceHandles]) -> None:
        await self._open_resource(control, "create")
        self.events.append("create")
        if self.fail_create:
            raise RuntimeError("create failed")

    @override
    async def on_context_resume(self, control: LayerControl[EmptyRuntimeState, ResourceHandles]) -> None:
        await self._open_resource(control, "resume")
        self.events.append("resume")
        if self.fail_resume:
            raise RuntimeError("resume failed")

    @override
    async def on_context_suspend(self, control: LayerControl[EmptyRuntimeState, ResourceHandles]) -> None:
        self.events.append("suspend")
        control.runtime_handles.resource = None
        if self.fail_suspend:
            raise RuntimeError("suspend failed")

    @override
    async def on_context_delete(self, control: LayerControl[EmptyRuntimeState, ResourceHandles]) -> None:
        self.events.append("delete")
        control.runtime_handles.resource = None
        if self.fail_delete:
            raise RuntimeError("delete failed")

    async def _open_resource(
        self,
        control: LayerControl[EmptyRuntimeState, ResourceHandles],
        label: str,
    ) -> None:
        resource = await control.enter_async_resource(RecordingResource(self.events, label))

        async def cleanup() -> None:
            self.events.append(f"cleanup:{label}")

        control.add_async_cleanup(cleanup)
        control.runtime_handles.resource = resource
        self.resources.append(resource)


def _resource_control(control: LayerControl) -> LayerControl[EmptyRuntimeState, ResourceHandles]:
    return cast(LayerControl[EmptyRuntimeState, ResourceHandles], control)


def test_entry_resource_stack_closes_resources_on_suspend_and_delete() -> None:
    layer = ResourceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
    session = compositor.new_session()

    async def run() -> None:
        async with compositor.enter(session) as active_session:
            control = _resource_control(active_session.layer("resource"))
            assert control.runtime_handles.resource is layer.resources[0]
            assert layer.resources[0].closed is False
            active_session.suspend_on_exit()

        assert _resource_control(session.layer("resource")).runtime_handles.resource is None
        assert layer.resources[0].closed is True

        async with compositor.enter(session):
            control = _resource_control(session.layer("resource"))
            assert control.runtime_handles.resource is layer.resources[1]
            assert layer.resources[1].closed is False

        assert _resource_control(session.layer("resource")).runtime_handles.resource is None
        assert layer.resources[1].closed is True

    asyncio.run(run())

    assert layer.events == [
        "enter:create",
        "create",
        "suspend",
        "cleanup:create",
        "exit:create",
        "enter:resume",
        "resume",
        "delete",
        "cleanup:resume",
        "exit:resume",
    ]


def test_entry_resource_stack_closes_resources_when_create_or_resume_raises() -> None:
    async def fail_create() -> None:
        layer = ResourceLayer(fail_create=True)
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
        session = compositor.new_session()

        with pytest.raises(RuntimeError, match="create failed"):
            async with compositor.enter(session):
                pass

        assert session.layer("resource").state is LifecycleState.NEW
        assert layer.resources[0].closed is True
        assert session.layer("resource")._entry_stack is None

    async def fail_resume() -> None:
        layer = ResourceLayer()
        compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
        session = compositor.new_session()

        async with compositor.enter(session) as active_session:
            active_session.suspend_on_exit()

        layer.fail_resume = True
        with pytest.raises(RuntimeError, match="resume failed"):
            async with compositor.enter(session):
                pass

        assert session.layer("resource").state is LifecycleState.SUSPENDED
        assert layer.resources[1].closed is True
        assert session.layer("resource")._entry_stack is None

    asyncio.run(fail_create())
    asyncio.run(fail_resume())


def test_entry_resource_stack_closes_resources_when_body_raises() -> None:
    layer = ResourceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
    session = compositor.new_session()

    async def run() -> None:
        with pytest.raises(RuntimeError, match="body failed"):
            async with compositor.enter(session):
                raise RuntimeError("body failed")

    asyncio.run(run())

    assert session.layer("resource").state is LifecycleState.CLOSED
    assert layer.resources[0].closed is True
    assert session.layer("resource")._entry_stack is None


def test_failed_suspend_hook_exits_active_state_and_closes_resources() -> None:
    layer = ResourceLayer(fail_suspend=True)
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
    session = compositor.new_session()

    async def run() -> None:
        with pytest.raises(RuntimeError, match="suspend failed"):
            async with compositor.enter(session) as active_session:
                active_session.suspend_on_exit()

        control = session.layer("resource")
        assert control.state is LifecycleState.SUSPENDED
        assert layer.resources[0].closed is True
        assert control._entry_stack is None
        with pytest.raises(RuntimeError, match="entry resource stack is not active"):
            await control.enter_async_resource(RecordingResource([], "unused"))
        with pytest.raises(RuntimeError, match="requires an active LayerControl"):
            _ = layer.require_control(control, active=True)

    asyncio.run(run())


def test_failed_delete_hook_exits_active_state_and_closes_resources() -> None:
    layer = ResourceLayer(fail_delete=True)
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(layers=OrderedDict([("resource", layer)]))
    session = compositor.new_session()

    async def run() -> None:
        with pytest.raises(RuntimeError, match="delete failed"):
            async with compositor.enter(session):
                pass

        control = session.layer("resource")
        assert control.state is LifecycleState.CLOSED
        assert layer.resources[0].closed is True
        assert control._entry_stack is None
        with pytest.raises(RuntimeError, match="entry resource stack is not active"):
            await control.enter_async_resource(RecordingResource([], "unused"))
        with pytest.raises(RuntimeError, match="requires an active LayerControl"):
            _ = layer.require_control(control, active=True)

    asyncio.run(run())


def test_resource_stack_api_raises_outside_active_entry_stack() -> None:
    control = LayerControl()

    async def cleanup() -> None:
        raise AssertionError("cleanup should not be registered")

    with pytest.raises(RuntimeError, match="entry resource stack is not active"):
        control.add_async_cleanup(cleanup)

    with pytest.raises(RuntimeError, match="entry resource stack is not active"):
        asyncio.run(control.enter_async_resource(RecordingResource([], "unused")))


def test_require_control_validates_owner_schema_and_active_state() -> None:
    layer = ResourceLayer()
    other_layer = TraceLayer()
    compositor: Compositor[PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict([("resource", layer), ("other", other_layer)])
    )
    session = compositor.new_session()
    control = session.layer("resource")

    with pytest.raises(RuntimeError, match="requires an active LayerControl"):
        _ = layer.require_control(control, active=True)

    with pytest.raises(RuntimeError, match="belongs to layer 'other'"):
        _ = layer.require_control(session.layer("other"))

    bad_control = LayerControl()
    bad_session = CompositorSession(OrderedDict([("resource", bad_control), ("other", other_layer.new_control())]))
    bad_session._bind_owner(compositor)
    with pytest.raises(TypeError, match="runtime_handles must be ResourceHandles"):
        _ = layer.require_control(bad_control)

    async def run() -> None:
        async with compositor.enter(session) as active_session:
            active_control = active_session.layer("resource")
            assert layer.require_control(active_control, active=True) is active_control

    asyncio.run(run())
