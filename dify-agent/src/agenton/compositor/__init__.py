"""Layer composition primitives.

The compositor owns a named, ordered set of layers. ``Compositor[PromptT,
ToolT, LayerPromptT, LayerToolT]`` is framework-neutral; callers choose layer and
exposed prompt/tool item types by annotating construction or assignment sites.
When only the first two type arguments are supplied, ``LayerPromptT`` and
``LayerToolT`` default to the corresponding exposed item types.

Layer instances are shared graph/capability definitions owned by the compositor.
Per-session runtime state belongs to each session's ``LayerControl`` objects,
not to the shared layer instances, so different sessions can enter the same
compositor without leaking generated ids or handles through ``self``.
Controls know their owning session and layer id privately so code running inside a
layer can use ``LayerControl.control_for`` to resolve dependency controls from the
same session. These owner links are runtime metadata and are never serialized in
session snapshots.

Dependency mappings use layer-local dependency names as keys and compositor
layer names as values. System prompt aggregation depends on insertion order:
prefix prompts are collected from first to last layer, while suffix prompts are
collected in reverse. User prompts are collected from first to last layer so the
composed user message preserves graph order.

Serializable graph config uses registry type ids rather than import paths.
``LayerNodeConfig.config`` accepts plain JSON values and ``LayerConfig`` DTO
instances; JSON serialization preserves concrete DTO fields before the builder
validates them with the registered layer schema. ``CompositorBuilder`` resolves
config nodes through ``LayerRegistry`` and can mix those nodes with live layer
instances for Python objects and callables. Registries may also supply factories
for layers that require server-side dependencies in addition to client DTOs.

``Compositor.enter`` enters layers in compositor order and exits them in reverse
order through ``AsyncExitStack``. It accepts an optional ``CompositorSession``
whose layer controls must match the compositor layer names and order. When
omitted, a fresh session is created. Reusing a suspended session resumes its
layer contexts; closed sessions must be replaced.

Optional prompt, user prompt, and tool transformers run after layer aggregation.
The compositor asks each layer to ``wrap_prompt``, ``wrap_user_prompt``, and
``wrap_tool`` its native values, so typed layer families can tag values without
changing their authoring contracts. When transformers are omitted, the
compositor returns those wrapped items unchanged.
"""

from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Iterable, Mapping as MappingABC, Sequence
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Generic, Mapping, TypedDict, cast, overload

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from typing_extensions import Self, TypeVar

from agenton.layers.base import Layer, LayerConfig, LayerConfigValue, LayerControl, LifecycleState
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes

PromptT = TypeVar("PromptT", default=AllPromptTypes)
ToolT = TypeVar("ToolT", default=AllToolTypes)
LayerPromptT = TypeVar("LayerPromptT", default=AllPromptTypes)
LayerToolT = TypeVar("LayerToolT", default=AllToolTypes)
UserPromptT = TypeVar("UserPromptT", default=AllUserPromptTypes)
LayerUserPromptT = TypeVar("LayerUserPromptT", default=AllUserPromptTypes)
LayerT = TypeVar("LayerT", bound=Layer[Any, Any, Any, Any, Any, Any, Any])
DepRuntimeStateT = TypeVar("DepRuntimeStateT", bound=BaseModel)
DepRuntimeHandlesT = TypeVar("DepRuntimeHandlesT", bound=BaseModel)


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
type LayerFactory = Callable[[LayerConfig], Layer[Any, Any, Any, Any, Any, Any, Any]]


def _validate_config_model_input[ModelT: BaseModel](
    model_type: type[ModelT],
    value: _ConfigModelValue[ModelT] | Mapping[str, object],
) -> ModelT:
    if isinstance(value, model_type):
        return value
    if isinstance(value, str | bytes):
        return model_type.model_validate_json(value)

    return model_type.model_validate(value)


class LayerNodeConfig(BaseModel):
    """Serializable config for one registry-backed layer node."""

    name: str
    type: str
    config: LayerConfigValue = Field(default_factory=dict)
    deps: Mapping[str, str] = Field(default_factory=dict)
    metadata: Mapping[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class CompositorConfig(BaseModel):
    """Serializable config for constructing a compositor graph.

    The graph references layer implementations by registry type id. Live Python
    objects and callables are intentionally excluded; compose those with
    ``CompositorBuilder.add_instance``.
    """

    schema_version: int = 1
    layers: list[LayerNodeConfig]

    model_config = ConfigDict(extra="forbid")


type CompositorConfigValue = _ConfigModelValue[CompositorConfig] | Mapping[str, object]


def _validate_compositor_config_input(value: CompositorConfigValue) -> CompositorConfig:
    return _validate_config_model_input(CompositorConfig, value)


@dataclass(frozen=True, slots=True)
class LayerDescriptor:
    """Registry descriptor inferred from a layer class."""

    type_id: str
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]]
    config_type: type[LayerConfig]
    runtime_state_type: type[BaseModel]
    runtime_handles_type: type[BaseModel]
    factory: LayerFactory | None = None


class LayerRegistry:
    """Manual registry for config-constructible layer classes.

    Registration infers config and runtime schemas from layer class attributes.
    A registered layer must have a type id, either declared as ``type_id`` on the
    class or supplied to ``register_layer``. Optional factories let server code
    inject dependencies that do not belong in public layer DTOs.
    """

    __slots__ = ("_descriptors",)

    _descriptors: dict[str, LayerDescriptor]

    def __init__(self) -> None:
        self._descriptors = {}

    def register_layer(
        self,
        layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]],
        *,
        type_id: str | None = None,
        factory: LayerFactory | None = None,
    ) -> None:
        """Register ``layer_type`` under its inferred or explicit type id.

        ``factory`` receives validated layer config and constructs the layer. It
        is intended for server-only dependencies such as clients or secrets; omit
        it for normal ``Layer.from_config`` construction.
        """
        resolved_type_id = type_id or layer_type.type_id
        if resolved_type_id is not None and not isinstance(resolved_type_id, str):
            raise TypeError(f"Layer type id for '{layer_type.__qualname__}' must be a string.")
        if resolved_type_id is None or not resolved_type_id:
            raise ValueError(f"Layer '{layer_type.__qualname__}' must declare a type_id or be registered with one.")
        if resolved_type_id in self._descriptors:
            raise ValueError(f"Layer type id '{resolved_type_id}' is already registered.")
        self._descriptors[resolved_type_id] = LayerDescriptor(
            type_id=resolved_type_id,
            layer_type=layer_type,
            config_type=layer_type.config_type,
            runtime_state_type=layer_type.runtime_state_type,
            runtime_handles_type=layer_type.runtime_handles_type,
            factory=factory,
        )

    def resolve(self, type_id: str) -> LayerDescriptor:
        """Return the descriptor for ``type_id`` or raise ``KeyError``."""
        try:
            return self._descriptors[type_id]
        except KeyError as e:
            raise KeyError(f"Layer type id '{type_id}' is not registered.") from e

    def descriptors(self) -> Mapping[str, LayerDescriptor]:
        """Return registered descriptors keyed by type id."""
        return dict(self._descriptors)


class CompositorSession:
    """External lifecycle session for layer contexts entered by a compositor.

    A session owns one ``LayerControl`` per compositor layer name, preserving
    compositor order. Controls must be created from the matching layer schemas;
    prefer ``Compositor.new_session`` or ``Compositor.session_from_snapshot`` for
    public session construction. Broadcast methods are convenience APIs for
    setting every layer's per-entry exit intent; ``layer`` allows explicit
    per-layer control when callers need partial suspend/delete behavior. A mixed
    session with any closed layer cannot be entered again because compositor
    entry is all-or-none. The session also carries private owner metadata so its
    controls can resolve dependency controls; snapshots include only public
    lifecycle/runtime state.
    """

    __slots__ = ("layer_controls", "_owner_compositor")

    layer_controls: OrderedDict[str, LayerControl]
    _owner_compositor: "Compositor[Any, Any, Any, Any, Any, Any] | None"

    def __init__(self, layer_names: Iterable[str] | Mapping[str, LayerControl]) -> None:
        self._owner_compositor = None
        if isinstance(layer_names, MappingABC):
            self.layer_controls = OrderedDict(layer_names.items())
            return
        self.layer_controls = OrderedDict((layer_name, LayerControl()) for layer_name in layer_names)

    def suspend_on_exit(self) -> None:
        """Request suspend behavior for every layer when this entry exits."""
        for control in self.layer_controls.values():
            control.suspend_on_exit()

    def delete_on_exit(self) -> None:
        """Request delete behavior for every layer when this entry exits."""
        for control in self.layer_controls.values():
            control.delete_on_exit()

    def layer(self, name: str) -> LayerControl:
        """Return the layer control for ``name`` or raise ``KeyError``."""
        try:
            return self.layer_controls[name]
        except KeyError as e:
            raise KeyError(f"CompositorSession has no layer control named '{name}'.") from e

    def _bind_owner(self, compositor: "Compositor[Any, Any, Any, Any, Any, Any]") -> None:
        """Bind runtime owner links on this session and all child controls."""
        self._owner_compositor = compositor
        for layer_id, control in self.layer_controls.items():
            control._bind_owner(self, layer_id)

    def _control_for_dependency(
        self,
        owner_layer_id: str,
        dep_name: str | None,
        dep_layer: Layer[Any, Any, Any, Any, Any, DepRuntimeStateT, DepRuntimeHandlesT],
    ) -> LayerControl[DepRuntimeStateT, DepRuntimeHandlesT]:
        """Resolve a dependency control from the owner's resolved dependency targets."""
        if self._owner_compositor is None:
            raise RuntimeError("CompositorSession is not attached to a compositor.")
        if dep_name is None:
            return self._control_for_unique_dependency(owner_layer_id, dep_layer)
        return self._control_for_named_dependency(owner_layer_id, dep_name, dep_layer)

    def _layer_for_control_owner(self, owner_layer_id: str) -> Layer[Any, Any, Any, Any, Any, Any, Any]:
        """Return the layer instance that owns a control in this session."""
        compositor = self._require_owner_compositor()
        try:
            return compositor.layers[owner_layer_id]
        except KeyError as e:
            raise KeyError(f"Layer '{owner_layer_id}' is not defined in this compositor.") from e

    def _control_for_unique_dependency(
        self,
        owner_layer_id: str,
        dep_layer: Layer[Any, Any, Any, Any, Any, DepRuntimeStateT, DepRuntimeHandlesT],
    ) -> LayerControl[DepRuntimeStateT, DepRuntimeHandlesT]:
        compositor = self._require_owner_compositor()
        dep_targets = self._dependency_targets_for(owner_layer_id)
        matches = [
            (name, target_id)
            for name, target_id in dep_targets.items()
            if target_id is not None and compositor.layers[target_id] is dep_layer
        ]
        if not matches:
            raise KeyError(
                f"Layer '{owner_layer_id}' has no dependency target bound to the provided "
                f"{type(dep_layer).__name__} instance."
            )
        if len(matches) > 1:
            names = ", ".join(name for name, _target_id in matches)
            raise ValueError(
                f"Layer '{owner_layer_id}' has multiple dependency fields bound to the provided "
                f"{type(dep_layer).__name__} instance: {names}. Pass dep_name explicitly."
            )
        _name, target_id = matches[0]
        return cast(LayerControl[DepRuntimeStateT, DepRuntimeHandlesT], self.layer(target_id))

    def _control_for_named_dependency(
        self,
        owner_layer_id: str,
        dep_name: str,
        dep_layer: Layer[Any, Any, Any, Any, Any, DepRuntimeStateT, DepRuntimeHandlesT],
    ) -> LayerControl[DepRuntimeStateT, DepRuntimeHandlesT]:
        compositor = self._require_owner_compositor()
        dep_targets = self._dependency_targets_for(owner_layer_id)
        if dep_name not in dep_targets:
            raise KeyError(f"Layer '{owner_layer_id}' has no resolved dependency named '{dep_name}'.")
        target_id = dep_targets[dep_name]
        if target_id is None:
            raise KeyError(f"Layer '{owner_layer_id}' dependency '{dep_name}' is not bound to a target layer.")
        if compositor.layers[target_id] is not dep_layer:
            raise TypeError(
                f"Layer '{owner_layer_id}' dependency '{dep_name}' resolves to layer '{target_id}', "
                f"not the provided {type(dep_layer).__name__} instance."
            )
        return cast(LayerControl[DepRuntimeStateT, DepRuntimeHandlesT], self.layer(target_id))

    def _require_owner_compositor(self) -> "Compositor[Any, Any, Any, Any, Any, Any]":
        if self._owner_compositor is None:
            raise RuntimeError("CompositorSession is not attached to a compositor.")
        return self._owner_compositor

    def _dependency_targets_for(self, owner_layer_id: str) -> Mapping[str, str | None]:
        compositor = self._require_owner_compositor()
        try:
            return compositor._resolved_dep_targets[owner_layer_id]
        except KeyError as e:
            raise KeyError(f"Layer '{owner_layer_id}' is not defined in this compositor.") from e


class LayerSessionSnapshot(BaseModel):
    """Serializable snapshot for one layer control."""

    name: str
    state: LifecycleState
    runtime_state: dict[str, JsonValue]

    model_config = ConfigDict(extra="forbid")


class CompositorSessionSnapshot(BaseModel):
    """Serializable compositor session snapshot.

    Snapshots include runtime state only. Live runtime handles are intentionally
    excluded and must be rehydrated by resume hooks using runtime state.
    """

    schema_version: int = 1
    layers: list[LayerSessionSnapshot]

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class _LayerBuildEntry:
    name: str
    layer: Layer[Any, Any, Any, Any, Any, Any, Any]
    deps: Mapping[str, str]


class CompositorBuilder:
    """Build compositors from registry config nodes and live instances."""

    __slots__ = ("_registry", "_entries")

    _registry: LayerRegistry
    _entries: list[_LayerBuildEntry]

    def __init__(self, registry: LayerRegistry) -> None:
        self._registry = registry
        self._entries = []

    def add_config(self, config: CompositorConfigValue) -> Self:
        """Add all layers from a serializable compositor config."""
        conf = _validate_compositor_config_input(config)
        if conf.schema_version != 1:
            raise ValueError(f"Unsupported compositor config schema_version: {conf.schema_version}.")
        for layer_conf in conf.layers:
            self.add_config_layer(
                name=layer_conf.name,
                type=layer_conf.type,
                config=layer_conf.config,
                deps=layer_conf.deps,
            )
        return self

    def add_config_layer(
        self,
        *,
        name: str,
        type: str,
        config: LayerConfigValue | None = None,
        deps: Mapping[str, str] | None = None,
    ) -> Self:
        """Resolve, validate, and add one registry-backed layer config node."""
        descriptor = self._registry.resolve(type)
        raw_config = {} if config is None else config
        validated_config = descriptor.config_type.model_validate(raw_config)
        if descriptor.factory is not None:
            layer = descriptor.factory(validated_config)
        else:
            layer = descriptor.layer_type.from_config(cast(Any, validated_config))
        self.add_instance(name=name, layer=layer, deps=deps)
        return self

    def add_instance(
        self,
        *,
        name: str,
        layer: Layer[Any, Any, Any, Any, Any, Any, Any],
        deps: Mapping[str, str] | None = None,
    ) -> Self:
        """Add a live layer instance, useful for Python objects and callables."""
        self._entries.append(_LayerBuildEntry(name=name, layer=layer, deps=dict(deps or {})))
        return self

    def build[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT](
        self,
        *,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> "Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]":
        """Validate names/dependencies, bind deps, and return a compositor."""
        layers: OrderedDict[str, Layer[Any, Any, Any, Any, Any, Any, Any]] = OrderedDict()
        deps_name_mapping: dict[str, Mapping[str, str]] = {}
        for entry in self._entries:
            if entry.name in layers:
                raise ValueError(f"Duplicate layer name '{entry.name}'.")
            layers[entry.name] = entry.layer
            deps_name_mapping[entry.name] = entry.deps

        layer_names = set(layers)
        for layer_name, deps in deps_name_mapping.items():
            declared_deps = layers[layer_name].dependency_names()
            unknown_dep_keys = set(deps) - declared_deps
            if unknown_dep_keys:
                names = ", ".join(sorted(unknown_dep_keys))
                raise ValueError(f"Layer '{layer_name}' declares unknown dependency keys: {names}.")
            missing_targets = set(deps.values()) - layer_names
            if missing_targets:
                names = ", ".join(sorted(missing_targets))
                raise ValueError(f"Layer '{layer_name}' depends on undefined layer names: {names}.")

        return Compositor(
            layers=layers,
            deps_name_mapping=deps_name_mapping,
            prompt_transformer=prompt_transformer,
            user_prompt_transformer=user_prompt_transformer,
            tool_transformer=tool_transformer,
        )


@dataclass(kw_only=True)
class Compositor(Generic[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]):
    """Framework-neutral ordered layer graph with lifecycle and aggregation.

    ``prompt_transformer``, ``user_prompt_transformer``, and
    ``tool_transformer`` are post-aggregation hooks: they run whenever
    ``prompts``, ``user_prompts``, or ``tools`` is read, after layer
    contributions have been collected in compositor order. Use two type
    arguments for identity aggregation, four when prompt/tool layer item types
    differ from exposed item types, or all six when user prompt item types also
    differ.
    """

    layers: OrderedDict[str, Layer[Any, Any, Any, Any, Any, Any, Any]]
    deps_name_mapping: Mapping[str, Mapping[str, str]] = field(default_factory=dict)
    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None
    tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None
    _deps_bound: bool = field(default=False, init=False)
    _resolved_dep_targets: dict[str, dict[str, str | None]] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._bind_deps(self.deps_name_mapping)

    @classmethod
    def from_config(
        cls,
        conf: CompositorConfigValue,
        *,
        registry: LayerRegistry,
        prompt_transformer: CompositorTransformer[LayerPromptT, PromptT] | None = None,
        user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT] | None = None,
        tool_transformer: CompositorTransformer[LayerToolT, ToolT] | None = None,
    ) -> "Compositor[PromptT, ToolT, LayerPromptT, LayerToolT, UserPromptT, LayerUserPromptT]":
        """Create a compositor from registry-backed serializable config."""
        return CompositorBuilder(registry).add_config(conf).build(
            prompt_transformer=prompt_transformer,
            user_prompt_transformer=user_prompt_transformer,
            tool_transformer=tool_transformer,
        )

    def _bind_deps(self, deps_name_mapping: Mapping[str, Mapping[str, str]]) -> None:
        """Resolve dependency-name mappings and bind dependencies on each layer.

        The outer mapping key is the layer being bound. The inner mapping key is
        the dependency field declared by that layer's deps type, and the value is
        the target layer name in this compositor. Explicit mappings win over
        implicit same-name layer binding. Optional dependencies with no target are
        recorded as ``None`` so ``LayerControl.control_for`` can distinguish
        "declared but absent" from unknown dependency names.
        """
        if self._deps_bound:
            raise RuntimeError("Compositor deps are already bound.")

        self._resolved_dep_targets = {}
        for layer_name, layer in self.layers.items():
            layer_deps = deps_name_mapping.get(layer_name, {})
            for target_layer_name in layer_deps.values():
                if target_layer_name not in self.layers:
                    raise ValueError(
                        f"Layer '{layer_name}' has a dependency on layer '{target_layer_name}', "
                        "which is not defined in the builder."
                    )

            resolved_target_ids: dict[str, str | None] = {}
            resolved_deps: dict[str, Layer[Any, Any, Any, Any, Any, Any, Any]] = {}
            for dep_name in layer.dependency_names():
                target_layer_name = layer_deps.get(dep_name)
                if target_layer_name is None and dep_name in self.layers:
                    target_layer_name = dep_name
                resolved_target_ids[dep_name] = target_layer_name
                if target_layer_name is not None:
                    resolved_deps[dep_name] = self.layers[target_layer_name]

            layer.bind_deps(resolved_deps)
            self._resolved_dep_targets[layer_name] = resolved_target_ids
        self._deps_bound = True

    @overload
    def get_layer(self, layer_id: str) -> Layer[Any, Any, Any, Any, Any, Any, Any]: ...

    @overload
    def get_layer(self, layer_id: str, layer_type: type[LayerT]) -> LayerT: ...

    def get_layer(
        self,
        layer_id: str,
        layer_type: type[LayerT] | None = None,
    ) -> Layer[Any, Any, Any, Any, Any, Any, Any] | LayerT:
        """Return a layer by compositor name and optionally validate its type."""
        try:
            layer = self.layers[layer_id]
        except KeyError as e:
            raise KeyError(f"Layer '{layer_id}' is not defined in this compositor.") from e

        if layer_type is not None and not isinstance(layer, layer_type):
            raise TypeError(
                f"Layer '{layer_id}' must be {layer_type.__name__}, got {type(layer).__name__}."
            )
        return layer

    def new_session(self) -> CompositorSession:
        """Create a fresh lifecycle session matching this compositor's layer order."""
        session = CompositorSession(
            OrderedDict((layer_name, layer.new_control()) for layer_name, layer in self.layers.items())
        )
        session._bind_owner(self)
        return session

    def snapshot_session(self, session: CompositorSession) -> CompositorSessionSnapshot:
        """Serialize non-active session lifecycle state and runtime state.

        Runtime handles are live Python objects and are intentionally excluded.
        """
        self._validate_session(session)
        active_layers = [name for name, control in session.layer_controls.items() if control.state is LifecycleState.ACTIVE]
        if active_layers:
            names = ", ".join(active_layers)
            raise RuntimeError(f"Cannot snapshot active compositor session layers: {names}.")
        return CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name=name,
                    state=control.state,
                    runtime_state=cast(dict[str, JsonValue], control.runtime_state.model_dump(mode="json")),
                )
                for name, control in session.layer_controls.items()
            ]
        )

    def session_from_snapshot(self, snapshot: CompositorSessionSnapshot | JsonValue | str | bytes) -> CompositorSession:
        """Restore a session from a snapshot and reinitialize empty handles."""
        snapshot = _validate_config_model_input(CompositorSessionSnapshot, snapshot)
        if snapshot.schema_version != 1:
            raise ValueError(f"Unsupported compositor session snapshot schema_version: {snapshot.schema_version}.")
        snapshot_layer_names = tuple(layer.name for layer in snapshot.layers)
        expected_layer_names = tuple(self.layers)
        if snapshot_layer_names != expected_layer_names:
            expected = ", ".join(expected_layer_names)
            actual = ", ".join(snapshot_layer_names)
            raise ValueError(
                "CompositorSessionSnapshot layer names must match compositor layers in order. "
                f"Expected [{expected}], got [{actual}]."
            )
        active_layers = [layer.name for layer in snapshot.layers if layer.state is LifecycleState.ACTIVE]
        if active_layers:
            names = ", ".join(active_layers)
            raise ValueError(f"Cannot restore active compositor session layers from snapshot: {names}.")
        controls = OrderedDict(
            (
                layer_snapshot.name,
                self.layers[layer_snapshot.name].new_control(
                    state=layer_snapshot.state,
                    runtime_state=layer_snapshot.runtime_state,
                ),
            )
            for layer_snapshot in snapshot.layers
        )
        session = CompositorSession(controls)
        session._bind_owner(self)
        return session

    @asynccontextmanager
    async def enter(
        self,
        session: CompositorSession | None = None,
    ) -> AsyncIterator[CompositorSession]:
        """Enter each layer context in order and yield the active session."""
        if not self._deps_bound:
            raise RuntimeError("Compositor deps must be bound before entering context.")

        if session is None:
            session = self.new_session()
        self._validate_session(session)
        self._ensure_session_can_enter(session)
        session._bind_owner(self)

        async with AsyncExitStack() as stack:
            for layer_name, layer in self.layers.items():
                await stack.enter_async_context(layer.enter(session.layer_controls[layer_name]))
            yield session

    def _validate_session(self, session: CompositorSession) -> None:
        expected_layer_names = tuple(self.layers)
        actual_layer_names = tuple(session.layer_controls)
        if actual_layer_names != expected_layer_names:
            expected = ", ".join(expected_layer_names)
            actual = ", ".join(actual_layer_names)
            raise ValueError(
                "CompositorSession layer names must match compositor layers in order. "
                f"Expected [{expected}], got [{actual}]."
            )
        for layer_name, layer in self.layers.items():
            control = session.layer_controls[layer_name]
            if not isinstance(control.runtime_state, layer.runtime_state_type):
                raise TypeError(
                    f"CompositorSession layer '{layer_name}' runtime_state must be "
                    f"{layer.runtime_state_type.__name__}, got {type(control.runtime_state).__name__}."
                )
            if not isinstance(control.runtime_handles, layer.runtime_handles_type):
                raise TypeError(
                    f"CompositorSession layer '{layer_name}' runtime_handles must be "
                    f"{layer.runtime_handles_type.__name__}, got {type(control.runtime_handles).__name__}."
                )

    def _ensure_session_can_enter(self, session: CompositorSession) -> None:
        """Reject active or closed layer controls before any layer side effects."""
        for control in session.layer_controls.values():
            if control.state is LifecycleState.ACTIVE:
                raise RuntimeError(
                    "LayerControl is already active; duplicate or nested enter is not allowed."
                )
            if control.state is LifecycleState.CLOSED:
                raise RuntimeError(
                    "LayerControl is closed; create a new compositor session before entering again."
                )

    @property
    def prompts(self) -> list[PromptT]:
        result: list[LayerPromptT] = []
        for layer in self.layers.values():
            result.extend(
                cast(LayerPromptT, layer.wrap_prompt(prompt))
                for prompt in layer.prefix_prompts
            )
        for layer in reversed(self.layers.values()):
            result.extend(
                cast(LayerPromptT, layer.wrap_prompt(prompt))
                for prompt in layer.suffix_prompts
            )
        if self.prompt_transformer is None:
            return cast(list[PromptT], result)
        return list(self.prompt_transformer(result))

    @property
    def user_prompts(self) -> list[UserPromptT]:
        result: list[LayerUserPromptT] = []
        for layer in self.layers.values():
            result.extend(
                cast(LayerUserPromptT, layer.wrap_user_prompt(prompt))
                for prompt in layer.user_prompts
            )
        if self.user_prompt_transformer is None:
            return cast(list[UserPromptT], result)
        return list(self.user_prompt_transformer(result))

    @property
    def tools(self) -> list[ToolT]:
        result: list[LayerToolT] = []
        for layer in self.layers.values():
            result.extend(cast(LayerToolT, layer.wrap_tool(tool)) for tool in layer.tools)
        if self.tool_transformer is None:
            return cast(list[ToolT], result)
        return list(self.tool_transformer(result))


__all__ = [
    "Compositor",
    "CompositorBuilder",
    "CompositorConfig",
    "CompositorConfigValue",
    "CompositorSessionSnapshot",
    "CompositorSession",
    "CompositorTransformer",
    "CompositorTransformerKwargs",
    "LayerDescriptor",
    "LayerFactory",
    "LayerNodeConfig",
    "LayerRegistry",
    "LayerSessionSnapshot",
]
