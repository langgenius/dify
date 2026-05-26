"""Active compositor run lifecycle, snapshots, and aggregation.

``CompositorRun`` is the only compositor object that exposes live layer
instances. It owns invocation-local lifecycle state, per-layer exit intent, and
the next ``session_snapshot`` after exit. Layers enter in graph order and exit
in reverse graph order. Prompt aggregation preserves graph ordering: prefix
prompts first-to-last, suffix prompts last-to-first, user prompts first-to-last,
and tools in graph order.

Prompt, user prompt, and tool transformers run only after layer-level wrapping
and run-level aggregation. When no transformer is installed, the wrapped items
are returned unchanged.
"""

from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Generic, cast, overload

from pydantic import JsonValue

from agenton.layers.base import ExitIntent, Layer, LifecycleState

from .schemas import CompositorSessionSnapshot, LayerSessionSnapshot
from .types import (
    CompositorTransformer,
    LayerPromptT,
    LayerT,
    LayerToolT,
    LayerUserPromptT,
    PromptT,
    ToolT,
    UserPromptT,
)


@dataclass(slots=True)
class LayerRunSlot:
    """Invocation-local lifecycle and exit state for one fresh layer instance."""

    layer: Layer[Any, Any, Any, Any, Any, Any]
    lifecycle_state: LifecycleState
    exit_intent: ExitIntent = ExitIntent.DELETE


@dataclass(slots=True)
class CompositorRun(Generic[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]):
    """Single-invocation runtime object created by ``Compositor.enter``.

    The run owns ordered ``LayerRunSlot`` objects and the fresh layers inside
    them. It is the only object that exposes live layers, lifecycle state, exit
    intent, and prompt/user-prompt/tool aggregation for an active invocation.
    After context exit, ``session_snapshot`` contains the next cross-call state.
    """

    slots: OrderedDict[str, LayerRunSlot]
    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None
    tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None
    session_snapshot: CompositorSessionSnapshot | None = None

    @overload
    def get_layer(self, name: str) -> Layer[Any, Any, Any, Any, Any, Any]: ...

    @overload
    def get_layer(self, name: str, layer_type: type[LayerT]) -> LayerT: ...

    def get_layer(
        self,
        name: str,
        layer_type: type[LayerT] | None = None,
    ) -> Layer[Any, Any, Any, Any, Any, Any] | LayerT:
        """Return a live layer by node name and optionally validate its type."""
        try:
            layer = self.slots[name].layer
        except KeyError as e:
            raise KeyError(f"Layer '{name}' is not defined in this compositor run.") from e

        if layer_type is not None and not isinstance(layer, layer_type):
            raise TypeError(f"Layer '{name}' must be {layer_type.__name__}, got {type(layer).__name__}.")
        return layer

    def suspend_on_exit(self) -> None:
        """Request suspend behavior for every active layer when the run exits."""
        for name in self.slots:
            self.suspend_layer_on_exit(name)

    def delete_on_exit(self) -> None:
        """Request delete behavior for every active layer when the run exits."""
        for name in self.slots:
            self.delete_layer_on_exit(name)

    def suspend_layer_on_exit(self, name: str) -> None:
        """Request suspend behavior for one active layer when the run exits."""
        self._set_layer_exit_intent(name, ExitIntent.SUSPEND)

    def delete_layer_on_exit(self, name: str) -> None:
        """Request delete behavior for one active layer when the run exits."""
        self._set_layer_exit_intent(name, ExitIntent.DELETE)

    def snapshot_session(self) -> CompositorSessionSnapshot:
        """Snapshot non-active layer lifecycle state and runtime state from this run."""
        active_layers = [name for name, slot in self.slots.items() if slot.lifecycle_state is LifecycleState.ACTIVE]
        if active_layers:
            names = ", ".join(active_layers)
            raise RuntimeError(f"Cannot snapshot active compositor run layers: {names}.")
        return CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name=name,
                    lifecycle_state=slot.lifecycle_state,
                    runtime_state=cast(dict[str, JsonValue], slot.layer.runtime_state.model_dump(mode="json")),
                )
                for name, slot in self.slots.items()
            ]
        )

    async def _enter_layers(self) -> None:
        self._ensure_layers_can_enter()
        entered_slots: list[LayerRunSlot] = []
        try:
            for slot in self.slots.values():
                await self._enter_slot(slot)
                entered_slots.append(slot)
        except BaseException as enter_error:
            hook_error = await self._exit_slots_reversed(entered_slots)
            self.session_snapshot = self.snapshot_session()
            if hook_error is not None:
                raise hook_error from enter_error
            raise

    async def _exit_layers(self) -> None:
        hook_error = await self._exit_slots_reversed(list(self.slots.values()))
        self.session_snapshot = self.snapshot_session()
        if hook_error is not None:
            raise hook_error

    async def _enter_slot(self, slot: LayerRunSlot) -> None:
        if slot.lifecycle_state is LifecycleState.NEW:
            slot.exit_intent = ExitIntent.DELETE
            await slot.layer.on_context_create()
            slot.lifecycle_state = LifecycleState.ACTIVE
            return
        if slot.lifecycle_state is LifecycleState.SUSPENDED:
            slot.exit_intent = ExitIntent.DELETE
            await slot.layer.on_context_resume()
            slot.lifecycle_state = LifecycleState.ACTIVE
            return
        raise RuntimeError(f"Cannot enter layer from lifecycle state '{slot.lifecycle_state}'.")

    async def _exit_slots_reversed(self, slots: Sequence[LayerRunSlot]) -> BaseException | None:
        hook_error: BaseException | None = None
        for slot in reversed(slots):
            if slot.lifecycle_state is not LifecycleState.ACTIVE:
                continue
            if slot.exit_intent is ExitIntent.SUSPEND:
                try:
                    await slot.layer.on_context_suspend()
                except BaseException as exc:
                    hook_error = hook_error or exc
                finally:
                    slot.lifecycle_state = LifecycleState.SUSPENDED
            else:
                try:
                    await slot.layer.on_context_delete()
                except BaseException as exc:
                    hook_error = hook_error or exc
                finally:
                    slot.lifecycle_state = LifecycleState.CLOSED

        return hook_error

    def _set_layer_exit_intent(self, name: str, intent: ExitIntent) -> None:
        try:
            slot = self.slots[name]
        except KeyError as e:
            raise KeyError(f"Layer '{name}' is not defined in this compositor run.") from e
        if slot.lifecycle_state is not LifecycleState.ACTIVE:
            raise RuntimeError("Layer exit intent can only be changed while the run slot is active.")
        slot.exit_intent = intent

    def _ensure_layers_can_enter(self) -> None:
        """Reject invalid external lifecycle states before any layer side effects."""
        for name, slot in self.slots.items():
            if slot.lifecycle_state is LifecycleState.ACTIVE:
                raise RuntimeError(f"Layer '{name}' is already active; ACTIVE snapshots are not allowed.")
            if slot.lifecycle_state is LifecycleState.CLOSED:
                raise RuntimeError(f"Layer '{name}' is closed; CLOSED snapshots cannot be entered.")

    @property
    def prompts(self) -> list[PromptT]:
        result: list[LayerPromptT] = []
        for slot in self.slots.values():
            layer = slot.layer
            result.extend(cast(LayerPromptT, layer.wrap_prompt(prompt)) for prompt in layer.prefix_prompts)
        for slot in reversed(self.slots.values()):
            layer = slot.layer
            result.extend(cast(LayerPromptT, layer.wrap_prompt(prompt)) for prompt in layer.suffix_prompts)
        if self.prompt_transformer is None:
            return cast(list[PromptT], result)
        return list(self.prompt_transformer(result))

    @property
    def user_prompts(self) -> list[UserPromptT]:
        result: list[LayerUserPromptT] = []
        for slot in self.slots.values():
            layer = slot.layer
            result.extend(cast(LayerUserPromptT, layer.wrap_user_prompt(prompt)) for prompt in layer.user_prompts)
        if self.user_prompt_transformer is None:
            return cast(list[UserPromptT], result)
        return list(self.user_prompt_transformer(result))

    @property
    def tools(self) -> list[ToolT]:
        result: list[LayerToolT] = []
        for slot in self.slots.values():
            layer = slot.layer
            result.extend(cast(LayerToolT, layer.wrap_tool(tool)) for tool in layer.tools)
        if self.tool_transformer is None:
            return cast(list[ToolT], result)
        return list(self.tool_transformer(result))
