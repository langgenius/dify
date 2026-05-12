"""Stateless layer graph composition for the Agenton core.

``Compositor`` is a reusable graph plan plus layer providers. It stores no live
layer instances, run lifecycle state, session state, resources, or handles. Each
``Compositor.enter(...)`` call creates a fresh ``CompositorRun`` that owns the
new layer instances and per-layer run slots for that invocation only.

Agenton core does not manage resources, handles, cleanup stacks, clients, or any
other live object. It composes the layer graph, validates node-name keyed configs
through providers, hydrates serializable ``runtime_state`` from an optional
``CompositorSessionSnapshot``, runs no-argument layer lifecycle hooks, and writes
the next session snapshot to ``run.session_snapshot`` after exit.
``LifecycleState.ACTIVE`` exists only while a run is entered; it is rejected in
external session snapshots and is never emitted.

Dependencies are direct layer instance relationships bound onto ``layer.deps``
inside one run. Dependency mappings use layer-local dependency names as keys and
compositor layer names as values. System prompt aggregation depends on graph
order: prefix prompts are collected from first to last layer, while suffix
prompts are collected in reverse. User prompts are collected from first to last
layer so the composed user message preserves graph order.

Serializable graph config uses provider type ids rather than import paths.
Graph nodes contain only name, type, dependency mapping, and metadata; runtime
state travels only in session snapshots and per-call layer config travels only
through ``Compositor.enter(configs=...)``. ``Compositor.from_config`` resolves
type ids from provider lists, and ``node_providers`` override type-id providers
for named nodes.

Optional prompt, user prompt, and tool transformers run after run-level layer
aggregation. The run asks each layer to ``wrap_prompt``, ``wrap_user_prompt``,
and ``wrap_tool`` its native values, so typed layer families can tag values
without changing their authoring contracts. When transformers are omitted, the
run returns those wrapped items unchanged.
"""

from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Generic, TypedDict, cast, overload
import weakref

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator
from typing_extensions import TypeVar

from agenton.layers.base import ExitIntent, Layer, LayerConfig, LayerConfigValue, LifecycleState
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes

PromptT = TypeVar("PromptT", default=AllPromptTypes)
ToolT = TypeVar("ToolT", default=AllToolTypes)
LayerPromptT = TypeVar("LayerPromptT", default=AllPromptTypes)
LayerToolT = TypeVar("LayerToolT", default=AllToolTypes)
UserPromptT = TypeVar("UserPromptT", default=AllUserPromptTypes)
LayerUserPromptT = TypeVar("LayerUserPromptT", default=AllUserPromptTypes)
LayerT = TypeVar("LayerT", bound=Layer[Any, Any, Any, Any, Any, Any])


type CompositorTransformer[InputT, OutputT] = Callable[[Sequence[InputT]], Sequence[OutputT]]


class CompositorTransformerKwargs[
    PromptT,
    ToolT,
    LayerPromptT,
    LayerToolT,
    UserPromptT,
    LayerUserPromptT,
](TypedDict):
    """Keyword arguments that install prompt, user prompt, and tool transformers."""

    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT]
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT]
    tool_transformer: CompositorTransformer[LayerToolT, ToolT]


type _ConfigModelValue[ModelT: BaseModel] = ModelT | JsonValue | str | bytes
type LayerConfigInput = LayerConfigValue | Mapping[str, object] | str | bytes | None
type LayerFactory = Callable[[LayerConfig], Layer[Any, Any, Any, Any, Any, Any]]
type LayerProviderInput = type[Layer[Any, Any, Any, Any, Any, Any]] | "LayerProvider[Any]"


def _validate_config_model_input[ModelT: BaseModel](
    model_type: type[ModelT],
    value: _ConfigModelValue[ModelT] | Mapping[str, object],
) -> ModelT:
    """Validate an external DTO boundary, including existing model instances.

    Pydantic models in this package are generally mutable and do not all enable
    assignment validation. Revalidating existing instances through their dumped
    data prevents post-construction mutations from bypassing config or snapshot
    validators at compositor entry boundaries.
    """
    if isinstance(value, BaseModel):
        return model_type.model_validate(value.model_dump(mode="python", warnings=False))
    if isinstance(value, str | bytes):
        return model_type.model_validate_json(value)

    return model_type.model_validate(value)


_USED_LAYER_INSTANCE_REFS: dict[int, weakref.ReferenceType[Layer[Any, Any, Any, Any, Any, Any]]] = {}


def _claim_fresh_layer_instance(layer: Layer[Any, Any, Any, Any, Any, Any]) -> None:
    """Reject provider factories that return a layer object used before.

    The registry stores weak references, not live resources or run state. It is
    intentionally global to keep ``Compositor`` stateless while still enforcing
    the proposal's fresh-instance boundary before any lifecycle hook can run.
    """
    layer_identity = id(layer)
    existing_ref = _USED_LAYER_INSTANCE_REFS.get(layer_identity)
    if existing_ref is not None:
        existing_layer = existing_ref()
        if existing_layer is not None:
            raise ValueError(
                "LayerProvider factories must return a fresh layer instance for each invocation; "
                f"got reused instance of '{type(layer).__name__}'."
            )
        _USED_LAYER_INSTANCE_REFS.pop(layer_identity, None)

    def remove_ref(ref: weakref.ReferenceType[Layer[Any, Any, Any, Any, Any, Any]]) -> None:
        if _USED_LAYER_INSTANCE_REFS.get(layer_identity) is ref:
            _USED_LAYER_INSTANCE_REFS.pop(layer_identity, None)

    _USED_LAYER_INSTANCE_REFS[layer_identity] = weakref.ref(layer, remove_ref)


class LayerProvider(Generic[LayerT]):
    """Validated layer factory for one concrete ``Layer`` class.

    Providers are reusable construction plans. They validate per-call config with
    ``layer_type.config_type`` before invoking either ``layer_type.from_config``
    or a custom factory. The factory receives only typed config, never graph node
    data, and must return a fresh ``layer_type`` instance; reused instances are
    rejected before dependencies are bound or hooks run.
    """

    __slots__ = ("_create", "layer_type")

    layer_type: type[LayerT]
    _create: Callable[[LayerConfig], LayerT]

    def __init__(self, *, layer_type: type[LayerT], create: Callable[[LayerConfig], LayerT]) -> None:
        self.layer_type = layer_type
        self._create = create

    @classmethod
    def from_layer_type(cls, layer_type: type[LayerT]) -> "LayerProvider[LayerT]":
        """Create a provider that constructs layers via ``layer_type.from_config``."""

        def create(config: LayerConfig) -> LayerT:
            return layer_type.from_config(cast(Any, config))

        return cls(layer_type=layer_type, create=create)

    @classmethod
    def from_factory(
        cls,
        *,
        layer_type: type[LayerT],
        create: Callable[[Any], LayerT],
    ) -> "LayerProvider[LayerT]":
        """Create a provider from a custom typed-config factory.

        ``create`` receives the validated instance of ``layer_type.config_type``.
        It does not receive the graph node; node-specific construction should use
        a dedicated provider in ``Compositor.from_config(node_providers=...)``.
        """
        return cls(layer_type=layer_type, create=cast(Callable[[LayerConfig], LayerT], create))

    @property
    def type_id(self) -> str | None:
        """Return the serializable registry type id declared by ``layer_type``."""
        return self.layer_type.type_id

    def create_layer(self, config: LayerConfigInput = None) -> LayerT:
        """Validate config, call the factory, and return a fresh layer instance."""
        typed_config = self.validate_config(config)
        return self.create_layer_from_config(typed_config)

    def validate_config(self, config: LayerConfigInput = None) -> LayerConfig:
        """Return typed config without invoking the layer factory.

        ``Compositor.enter`` calls this for every node before creating any layer
        so a later invalid node config cannot leave earlier factory side effects.
        """
        raw_config: LayerConfigValue | Mapping[str, object] | str | bytes = {} if config is None else config
        return _validate_config_model_input(self.layer_type.config_type, raw_config)

    def create_layer_from_config(self, config: LayerConfig) -> LayerT:
        """Call the factory with validated config and enforce fresh instances."""
        typed_config = self.validate_config(config)
        layer = self._create(typed_config)
        if not isinstance(layer, self.layer_type):
            raise TypeError(
                f"LayerProvider for '{self.layer_type.__name__}' returned '{type(layer).__name__}', "
                f"expected '{self.layer_type.__name__}'."
            )
        _claim_fresh_layer_instance(layer)
        layer.config = cast(Any, typed_config)
        return layer


@dataclass(frozen=True, slots=True, init=False)
class LayerNode:
    """Stateless graph node plan for one named layer provider.

    ``implementation`` may be a layer class or an explicit ``LayerProvider``.
    ``deps`` maps dependency field names on this node's layer class to other
    compositor node names. ``metadata`` is graph description data only; it is not
    passed to provider factories and is never included in session snapshots.
    """

    name: str
    provider: LayerProvider[Any]
    deps: Mapping[str, str]
    metadata: Mapping[str, JsonValue]

    def __init__(
        self,
        name: str,
        implementation: LayerProviderInput,
        *,
        deps: Mapping[str, str] | None = None,
        metadata: Mapping[str, JsonValue] | None = None,
    ) -> None:
        if not name:
            raise ValueError("Layer node name must not be empty.")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "provider", _as_layer_provider(implementation))
        object.__setattr__(self, "deps", dict(deps or {}))
        object.__setattr__(self, "metadata", dict(metadata or {}))


class LayerNodeConfig(BaseModel):
    """Serializable config for one provider-backed layer graph node.

    Nodes intentionally contain no runtime state and no per-call layer config.
    Runtime state belongs to session snapshots; layer config belongs to
    ``Compositor.enter(configs=...)`` keyed by node name.
    """

    name: str
    type: str
    deps: Mapping[str, str] = Field(default_factory=dict)
    metadata: Mapping[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class CompositorConfig(BaseModel):
    """Serializable config for constructing a reusable compositor graph plan."""

    schema_version: int = 1
    layers: list[LayerNodeConfig]

    model_config = ConfigDict(extra="forbid")


type CompositorConfigValue = _ConfigModelValue[CompositorConfig] | Mapping[str, object]


def _validate_compositor_config_input(value: CompositorConfigValue) -> CompositorConfig:
    return _validate_config_model_input(CompositorConfig, value)


class LayerSessionSnapshot(BaseModel):
    """Serializable snapshot for one layer's state-only invocation data.

    ``runtime_state`` is the only snapshotted mutable layer data. ``ACTIVE`` is
    rejected here because a running layer cannot be represented safely outside
    the active compositor entry.
    """

    name: str
    lifecycle_state: LifecycleState
    runtime_state: dict[str, JsonValue]

    model_config = ConfigDict(extra="forbid")

    @field_validator("lifecycle_state")
    @classmethod
    def _reject_active_lifecycle(cls, value: LifecycleState) -> LifecycleState:
        if value is LifecycleState.ACTIVE:
            raise ValueError("LifecycleState.ACTIVE is internal-only and cannot appear in session snapshots.")
        return value


class CompositorSessionSnapshot(BaseModel):
    """Serializable compositor session snapshot.

    Snapshots include ordered layer lifecycle state and serializable runtime
    state only. Live resources, handles, dependencies, prompts, tools, and config
    are outside Agenton snapshots and are never captured here.
    """

    schema_version: int = 1
    layers: list[LayerSessionSnapshot]

    model_config = ConfigDict(extra="forbid")


type CompositorSessionSnapshotValue = _ConfigModelValue[CompositorSessionSnapshot] | Mapping[str, object]


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


class Compositor(Generic[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]):
    """Reusable, framework-neutral ordered layer graph plan.

    A compositor stores only immutable graph nodes and provider construction
    plans. It is safe to enter repeatedly or concurrently because every entry
    creates a separate ``CompositorRun`` with fresh layer instances, run slots,
    dependency bindings, and optional hydrated runtime state. Session continuity
    is explicit: pass the previous ``CompositorSessionSnapshot`` to the next
    ``enter`` call and read the next one from ``run.session_snapshot`` after
    exit.

    ``prompt_transformer``, ``user_prompt_transformer``, and
    ``tool_transformer`` are post-aggregation hooks on each run. Use two type
    arguments for identity aggregation, four when prompt/tool layer item types
    differ from exposed item types, or all six when user prompt item types also
    differ.
    """

    __slots__ = ("_nodes", "prompt_transformer", "tool_transformer", "user_prompt_transformer")

    _nodes: tuple[LayerNode, ...]
    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None
    tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None

    def __init__(
        self,
        nodes: Sequence[LayerNode],
        *,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> None:
        self._nodes = tuple(nodes)
        self.prompt_transformer = prompt_transformer
        self.user_prompt_transformer = user_prompt_transformer
        self.tool_transformer = tool_transformer
        self._validate_nodes()

    @property
    def nodes(self) -> tuple[LayerNode, ...]:
        """Return the stateless graph plan nodes in compositor order."""
        return self._nodes

    @classmethod
    def from_config(
        cls,
        conf: CompositorConfigValue,
        *,
        providers: Sequence[LayerProviderInput],
        node_providers: Mapping[str, LayerProviderInput] | None = None,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> "Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]":
        """Create a reusable compositor plan from serializable graph config.

        ``providers`` resolve graph node ``type`` ids. ``node_providers`` are
        keyed by graph node name and take precedence over the type-id provider,
        allowing node-specific construction without passing node data to factory
        callables.
        """
        graph_config = _validate_compositor_config_input(conf)
        if graph_config.schema_version != 1:
            raise ValueError(f"Unsupported compositor config schema_version: {graph_config.schema_version}.")

        provider_by_type = _build_provider_type_map(providers)
        provider_by_node = {name: _as_layer_provider(provider) for name, provider in (node_providers or {}).items()}
        graph_node_names = {node.name for node in graph_config.layers}
        unknown_node_providers = provider_by_node.keys() - graph_node_names
        if unknown_node_providers:
            names = ", ".join(sorted(unknown_node_providers))
            raise ValueError(f"node_providers contains unknown layer node names: {names}.")

        nodes: list[LayerNode] = []
        for node_config in graph_config.layers:
            provider = provider_by_node.get(node_config.name)
            if provider is None:
                try:
                    provider = provider_by_type[node_config.type]
                except KeyError as e:
                    raise KeyError(f"Layer type id '{node_config.type}' is not registered.") from e
            nodes.append(
                LayerNode(
                    node_config.name,
                    provider,
                    deps=node_config.deps,
                    metadata=node_config.metadata,
                )
            )

        return cls(
            nodes,
            prompt_transformer=prompt_transformer,
            user_prompt_transformer=user_prompt_transformer,
            tool_transformer=tool_transformer,
        )

    @asynccontextmanager
    async def enter(
        self,
        *,
        configs: Mapping[str, LayerConfigInput] | None = None,
        session_snapshot: CompositorSessionSnapshotValue | None = None,
    ) -> AsyncIterator[CompositorRun[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]]:
        """Create a fresh run, enter layers in graph order, and yield it.

        Configs are keyed by layer node name and validated before factories run.
        The optional session snapshot is validated and hydrated before any hook
        runs. Layers exit in reverse graph order, and ``run.session_snapshot`` is
        populated after exit with the next non-active lifecycle states.
        """
        run = self._create_run(configs=configs, session_snapshot=session_snapshot)
        await run._enter_layers()
        try:
            yield run
        finally:
            await run._exit_layers()

    def _create_run(
        self,
        *,
        configs: Mapping[str, LayerConfigInput] | None,
        session_snapshot: CompositorSessionSnapshotValue | None,
    ) -> CompositorRun[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]:
        config_by_name = self._validate_run_configs(configs)
        typed_config_by_name = self._validate_layer_configs(config_by_name)
        snapshot = self._validate_session_snapshot(session_snapshot) if session_snapshot is not None else None
        layer_by_name = self._create_layers(typed_config_by_name)

        snapshot_by_name = {layer_snapshot.name: layer_snapshot for layer_snapshot in snapshot.layers} if snapshot else {}
        lifecycle_by_name: dict[str, LifecycleState] = {}
        for node in self._nodes:
            layer = layer_by_name[node.name]
            layer_snapshot = snapshot_by_name.get(node.name)
            if layer_snapshot is None:
                lifecycle_by_name[node.name] = LifecycleState.NEW
                continue
            layer.runtime_state = cast(Any, layer.runtime_state_type.model_validate(layer_snapshot.runtime_state))
            lifecycle_by_name[node.name] = layer_snapshot.lifecycle_state

        self._bind_deps(layer_by_name)
        return CompositorRun(
            slots=OrderedDict(
                (node.name, LayerRunSlot(layer=layer_by_name[node.name], lifecycle_state=lifecycle_by_name[node.name]))
                for node in self._nodes
            ),
            prompt_transformer=self.prompt_transformer,
            user_prompt_transformer=self.user_prompt_transformer,
            tool_transformer=self.tool_transformer,
        )

    def _create_layers(
        self,
        config_by_name: Mapping[str, LayerConfig],
    ) -> OrderedDict[str, Layer[Any, Any, Any, Any, Any, Any]]:
        return OrderedDict(
            (node.name, node.provider.create_layer_from_config(config_by_name[node.name]))
            for node in self._nodes
        )

    def _validate_layer_configs(self, config_by_name: Mapping[str, LayerConfigInput]) -> dict[str, LayerConfig]:
        """Validate every node config before any provider factory is invoked."""
        return {
            node.name: node.provider.validate_config(config_by_name.get(node.name))
            for node in self._nodes
        }

    def _bind_deps(self, layer_by_name: Mapping[str, Layer[Any, Any, Any, Any, Any, Any]]) -> None:
        """Resolve dependency-name mappings and bind direct layer dependencies."""
        for node in self._nodes:
            layer = layer_by_name[node.name]
            resolved_deps = {dep_name: layer_by_name[target_name] for dep_name, target_name in node.deps.items()}
            layer.bind_deps(resolved_deps)

    def _validate_nodes(self) -> None:
        layer_names: set[str] = set()
        for node in self._nodes:
            if node.name in layer_names:
                raise ValueError(f"Duplicate layer name '{node.name}'.")
            layer_names.add(node.name)

        for node in self._nodes:
            declared_deps = node.provider.layer_type.dependency_names()
            unknown_dep_keys = set(node.deps) - declared_deps
            if unknown_dep_keys:
                names = ", ".join(sorted(unknown_dep_keys))
                raise ValueError(f"Layer '{node.name}' declares unknown dependency keys: {names}.")
            missing_targets = set(node.deps.values()) - layer_names
            if missing_targets:
                names = ", ".join(sorted(missing_targets))
                raise ValueError(f"Layer '{node.name}' depends on undefined layer names: {names}.")

    def _validate_run_configs(self, configs: Mapping[str, LayerConfigInput] | None) -> dict[str, LayerConfigInput]:
        config_by_name = dict(configs or {})
        known_names = {node.name for node in self._nodes}
        unknown_names = config_by_name.keys() - known_names
        if unknown_names:
            names = ", ".join(sorted(unknown_names))
            raise ValueError(f"Layer configs contain unknown layer node names: {names}.")
        return config_by_name

    def _validate_session_snapshot(
        self,
        snapshot: CompositorSessionSnapshotValue,
    ) -> CompositorSessionSnapshot:
        resolved_snapshot = _validate_config_model_input(CompositorSessionSnapshot, snapshot)
        if resolved_snapshot.schema_version != 1:
            raise ValueError(
                f"Unsupported compositor session snapshot schema_version: {resolved_snapshot.schema_version}."
            )
        expected_layer_names = tuple(node.name for node in self._nodes)
        actual_layer_names = tuple(layer.name for layer in resolved_snapshot.layers)
        if actual_layer_names != expected_layer_names:
            expected = ", ".join(expected_layer_names)
            actual = ", ".join(actual_layer_names)
            raise ValueError(
                "CompositorSessionSnapshot layer names must match compositor layers in order. "
                f"Expected [{expected}], got [{actual}]."
            )
        return resolved_snapshot


def _as_layer_provider(implementation: LayerProviderInput) -> LayerProvider[Any]:
    if isinstance(implementation, LayerProvider):
        return implementation
    if isinstance(implementation, type) and issubclass(implementation, Layer):
        return LayerProvider.from_layer_type(implementation)
    raise TypeError("LayerNode implementation must be a Layer subclass or LayerProvider.")


def _build_provider_type_map(providers: Sequence[LayerProviderInput]) -> dict[str, LayerProvider[Any]]:
    provider_by_type: dict[str, LayerProvider[Any]] = {}
    for provider_input in providers:
        provider = _as_layer_provider(provider_input)
        type_id = provider.type_id
        if type_id is None or not type_id:
            raise ValueError(f"Layer provider for '{provider.layer_type.__qualname__}' must declare a type_id.")
        if type_id in provider_by_type:
            raise ValueError(f"Layer type id '{type_id}' is already registered.")
        provider_by_type[type_id] = provider
    return provider_by_type


__all__ = [
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
