"""Invocation-scoped core layer abstractions and typed dependency binding.

Agenton core deliberately manages only three concerns: stateless layer graph
composition, serializable ``runtime_state`` lifecycle, and session snapshots. It
does not own live resources, process handles, HTTP clients, cleanup stacks, or
any other non-serializable runtime object. Those belong to application layers or
integration code outside the core.

Layers declare their dependency shape with
``Layer[DepsT, PromptT, UserPromptT, ToolT, ConfigT, RuntimeStateT]``.
``DepsT`` must be a ``LayerDeps`` subclass whose annotated members are concrete
``Layer`` subclasses or modern optional dependencies such as ``SomeLayer | None``.
Dependencies are direct layer instance relationships bound onto ``self.deps``
for one compositor invocation; there is no dependency-control lookup API in the
core.

``LayerConfig`` is the DTO base for config schemas accepted by layer providers.
The provider validates raw node-name keyed configs with a layer's
``config_type`` before constructing the layer and assigning ``self.config``.
``runtime_state_type`` is the only mutable schema managed by Agenton and the only
per-layer data included in session snapshots. The base class infers
``deps_type``, ``config_type``, and ``runtime_state_type`` from generic bases
when possible, while still allowing subclasses to set them explicitly for
unusual inheritance patterns.

``Layer`` is an invocation-scoped business object. It owns ``config``, direct
``deps``, and serializable ``runtime_state`` plus prompt/tool authoring surfaces,
but it does not own lifecycle state, exit intent, graph owner tokens, entry
stacks, resources, or cleanup callbacks. ``CompositorRun`` owns lifecycle state
and exit intent for one entry. ``SessionSnapshot`` objects are the only supported
cross-call state carrier.

Lifecycle hooks are no-argument business hooks on the layer instance:
``on_context_create/resume/suspend/delete(self)``. They should read dependencies
from ``self.deps`` and read or mutate serializable invocation state through
``self.runtime_state``. Resource acquisition and deterministic cleanup should be
handled outside Agenton core, for example by integration-specific context
managers that wrap compositor entry.

``Layer`` is framework-neutral over system prompt, user prompt, and tool item
types. The native ``prefix_prompts``, ``suffix_prompts``, ``user_prompts``, and
``tools`` properties are the layer authoring surface. ``wrap_prompt``,
``wrap_user_prompt``, and ``wrap_tool`` are the compositor aggregation surface;
typed families such as ``agenton.layers.types.PlainLayer`` implement them to tag
native values without changing layer implementations.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from types import UnionType
from typing import (
    Any,
    ClassVar,
    Generic,
    Union,
    cast,
    get_args,
    get_origin,
    get_type_hints,
)

from pydantic import BaseModel, ConfigDict, JsonValue, SerializeAsAny
from typing_extensions import Self, TypeVar


_DepsT = TypeVar("_DepsT", bound="LayerDeps")
_PromptT = TypeVar("_PromptT")
_UserPromptT = TypeVar("_UserPromptT")
_ToolT = TypeVar("_ToolT")


class LayerConfig(BaseModel):
    """Base DTO for serializable layer configuration.

    Layer providers validate raw config values with concrete ``LayerConfig``
    subclasses before constructing a layer for one invocation. Serializable
    compositor graph config references layer type ids and node metadata only;
    per-call config travels through ``Compositor.enter(configs=...)``.
    """

    model_config = ConfigDict(extra="forbid")


type LayerConfigValue = JsonValue | SerializeAsAny[LayerConfig]


_ConfigT = TypeVar("_ConfigT", bound=LayerConfig, default="EmptyLayerConfig")
_RuntimeStateT = TypeVar("_RuntimeStateT", bound=BaseModel, default="EmptyRuntimeState")


class LayerDeps:
    """Typed dependency container for a layer.

    Subclasses declare dependency members with annotations. Every annotated
    member must be a Layer subclass or ``LayerSubclass | None``. Optional deps
    are always assigned as attributes; missing optional values become ``None``.
    """

    def __init__(self, **deps: "Layer[Any, Any, Any, Any, Any, Any] | None") -> None:
        dep_specs = _get_dep_specs(type(self))
        missing_names = {name for name, spec in dep_specs.items() if not spec.optional} - deps.keys()
        if missing_names:
            names = ", ".join(sorted(missing_names))
            raise ValueError(f"Missing layer dependencies: {names}.")

        unknown_names = deps.keys() - dep_specs.keys()
        if unknown_names:
            names = ", ".join(sorted(unknown_names))
            raise ValueError(f"Unknown layer dependencies: {names}.")

        for name, spec in dep_specs.items():
            value = deps.get(name)
            if value is None:
                if spec.optional:
                    setattr(self, name, None)
                    continue
                raise ValueError(f"Dependency '{name}' is required but not provided.")

            if not isinstance(value, spec.layer_type):
                raise TypeError(
                    f"Dependency '{name}' should be of type '{spec.layer_type.__name__}', "
                    f"but got type '{type(value).__name__}'."
                )
            setattr(self, name, value)


class NoLayerDeps(LayerDeps):
    """Dependency container for layers that do not require other layers."""


class EmptyLayerConfig(LayerConfig):
    """Default serializable config schema for layers without config."""

    model_config = ConfigDict(extra="forbid")


class EmptyRuntimeState(BaseModel):
    """Default serializable invocation runtime state schema."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class LifecycleState(StrEnum):
    """Lifecycle state for one run slot.

    ``ACTIVE`` is internal-only. It is used while an invocation is running and
    must never appear in external session snapshots or hydrated input.
    """

    NEW = "new"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CLOSED = "closed"


class ExitIntent(StrEnum):
    """Run-slot exit behavior requested during active invocation."""

    DELETE = "delete"
    SUSPEND = "suspend"


@dataclass(frozen=True, slots=True)
class LayerDepSpec:
    """Runtime dependency specification derived from a deps annotation."""

    layer_type: type["Layer[Any, Any, Any, Any, Any, Any]"]
    optional: bool = False


class Layer(
    ABC,
    Generic[_DepsT, _PromptT, _UserPromptT, _ToolT, _ConfigT, _RuntimeStateT],
):
    """Framework-neutral base class for prompt/tool layers.

    A layer instance is invocation-scoped mutable business state, not a reusable
    cross-session definition. ``CompositorRun`` creates fresh instances through
    layer providers, assigns validated ``config``, binds direct dependency layer
    instances to ``deps``, hydrates ``runtime_state`` from an optional session
    snapshot, and then runs no-argument lifecycle hooks. The run owns lifecycle
    state and exit intent; layers never expose a public entry context manager.

    Live resources and handles are intentionally outside this abstraction. Only
    ``runtime_state`` is managed and snapshotted by Agenton core. Lifecycle hooks
    should operate on ``self`` and keep any non-serializable cleanup policy in
    integration code that wraps the compositor.
    """

    deps_type: type[_DepsT]
    config: _ConfigT
    deps: _DepsT
    runtime_state: _RuntimeStateT
    type_id: ClassVar[str | None] = None
    config_type: ClassVar[type[LayerConfig]] = EmptyLayerConfig
    runtime_state_type: ClassVar[type[BaseModel]] = EmptyRuntimeState

    def __new__(cls, *args: object, **kwargs: object) -> Self:
        instance = cast(Self, super().__new__(cls))
        runtime_state_type = getattr(cls, "runtime_state_type", None)
        if isinstance(runtime_state_type, type) and issubclass(runtime_state_type, BaseModel):
            instance.runtime_state = cast(Any, runtime_state_type.model_validate({}))
        return instance

    def __init_subclass__(cls) -> None:
        super().__init_subclass__()
        is_generic_template = _is_generic_layer_template(cls)
        deps_type = cls.__dict__.get("deps_type")
        if deps_type is None:
            deps_type = _infer_deps_type(cls) or getattr(cls, "deps_type", None)
            if deps_type is None and is_generic_template:
                return
            if deps_type is not None:
                cls.deps_type = deps_type  # pyright: ignore[reportAttributeAccessIssue]
        if deps_type is None:
            raise TypeError(f"{cls.__name__} must define deps_type or inherit from Layer[DepsT].")
        if not isinstance(deps_type, type) or not issubclass(deps_type, LayerDeps):
            raise TypeError(f"{cls.__name__}.deps_type must be a LayerDeps subclass.")
        _get_dep_specs(deps_type)
        _init_config_type(cls, _infer_config_type(cls))
        _init_schema_type(
            cls,
            "runtime_state_type",
            _infer_schema_type(cls, 5, "runtime_state_type"),
            EmptyRuntimeState,
        )

    @classmethod
    def from_config(cls: type[Self], config: _ConfigT) -> Self:
        """Create a layer from schema-validated serialized config.

        ``LayerProvider.from_layer_type`` validates raw config with
        ``config_type`` before calling this method. Layers without config use the
        default no-argument construction path. Layers with a concrete config
        schema should override this method and consume the typed Pydantic model.
        """
        if cls.config_type is not EmptyLayerConfig:
            raise TypeError(f"{cls.__name__} cannot be created from config; override from_config or use a provider.")
        EmptyLayerConfig.model_validate(config)
        try:
            return cast(Self, cls())
        except TypeError as e:
            raise TypeError(f"{cls.__name__} cannot be created from empty config; use a custom provider.") from e

    @classmethod
    def dependency_names(cls) -> frozenset[str]:
        """Return dependency field names declared by this layer's deps schema."""
        return frozenset(_get_dep_specs(cls.deps_type))

    def bind_deps(self, deps: Mapping[str, "Layer[Any, Any, Any, Any, Any, Any] | None"]) -> None:
        """Bind this layer's declared dependencies from a name-to-layer mapping.

        The mapping may include more layers than the declared dependency fields.
        Only names declared by ``deps_type`` are selected and validated. Missing
        optional deps are bound as ``None``. Bound values are direct layer
        instances for this invocation graph.
        """
        resolved_deps: dict[str, Layer[Any, Any, Any, Any, Any, Any] | None] = {}
        for name, spec in _get_dep_specs(self.deps_type).items():
            if name not in deps:
                if spec.optional:
                    resolved_deps[name] = None
                    continue
                raise ValueError(f"Dependency '{name}' is required for layer '{type(self).__name__}' but not provided.")
            resolved_deps[name] = deps[name]
        self.deps = self.deps_type(**resolved_deps)

    async def on_context_create(self) -> None:
        """Run when the run slot enters from ``LifecycleState.NEW``."""

    async def on_context_delete(self) -> None:
        """Run when the run slot exits with ``ExitIntent.DELETE``."""

    async def on_context_suspend(self) -> None:
        """Run when the run slot exits with ``ExitIntent.SUSPEND``."""

    async def on_context_resume(self) -> None:
        """Run when the run slot enters from ``LifecycleState.SUSPENDED``."""

    @property
    def prefix_prompts(self) -> Sequence[_PromptT]:
        return []

    @property
    def suffix_prompts(self) -> Sequence[_PromptT]:
        return []

    @property
    def user_prompts(self) -> Sequence[_UserPromptT]:
        return []

    @property
    def tools(self) -> Sequence[_ToolT]:
        return []

    @abstractmethod
    def wrap_prompt(self, prompt: _PromptT) -> object:
        """Wrap a native prompt item for run-level aggregation."""
        raise NotImplementedError

    @abstractmethod
    def wrap_user_prompt(self, prompt: _UserPromptT) -> object:
        """Wrap a native user prompt item for run-level aggregation."""
        raise NotImplementedError

    @abstractmethod
    def wrap_tool(self, tool: _ToolT) -> object:
        """Wrap a native tool item for run-level aggregation."""
        raise NotImplementedError


def _get_dep_specs(deps_type: type[LayerDeps]) -> dict[str, LayerDepSpec]:
    dep_specs: dict[str, LayerDepSpec] = {}
    for name, annotation in get_type_hints(deps_type).items():
        spec = _as_dep_spec(annotation)
        if spec is None:
            raise TypeError(
                f"{deps_type.__name__}.{name} must be annotated with a Layer subclass or Layer subclass | None."
            )
        dep_specs[name] = spec
    return dep_specs


def _as_dep_spec(annotation: object) -> LayerDepSpec | None:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin in (UnionType, Union) and len(args) == 2 and type(None) in args:
        layer_annotation = args[0] if args[1] is type(None) else args[1]
        layer_type = _as_layer_type(layer_annotation)
        if layer_type is None:
            return None
        return LayerDepSpec(layer_type=layer_type, optional=True)

    layer_type = _as_layer_type(annotation)
    if layer_type is None:
        return None
    return LayerDepSpec(layer_type=layer_type)


def _as_layer_type(annotation: object) -> type[Layer[Any, Any, Any, Any, Any, Any]] | None:
    runtime_type = get_origin(annotation) or annotation
    if isinstance(runtime_type, type) and issubclass(runtime_type, Layer):
        return cast(type[Layer[Any, Any, Any, Any, Any, Any]], runtime_type)
    return None


def _infer_deps_type(layer_type: type[Layer[Any, Any, Any, Any, Any, Any]]) -> type[LayerDeps] | None:
    inferred = _infer_layer_generic_arg(layer_type, 0, {})
    if inferred is None:
        return None
    return _as_deps_type(inferred)


def _infer_schema_type(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any]],
    index: int,
    attr_name: str,
) -> type[BaseModel] | None:
    inferred = _infer_schema_generic_arg(layer_type, attr_name, {}) or _infer_layer_generic_arg(layer_type, index, {})
    if inferred is None:
        return None
    schema_type = _as_model_type(inferred)
    if schema_type is None:
        raise TypeError(f"{layer_type.__name__}.{attr_name} must be a Pydantic BaseModel subclass.")
    return schema_type


def _infer_config_type(layer_type: type[Layer[Any, Any, Any, Any, Any, Any]]) -> type[LayerConfig] | None:
    inferred = _infer_schema_generic_arg(layer_type, "config_type", {}) or _infer_layer_generic_arg(layer_type, 4, {})
    if inferred is None:
        return None
    config_type = _as_config_type(inferred)
    if config_type is None:
        raise TypeError(f"{layer_type.__name__}.config_type must be a LayerConfig subclass.")
    return config_type


def _infer_schema_generic_arg(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any]],
    attr_name: str,
    substitutions: Mapping[object, object],
) -> object | None:
    """Infer schema type arguments exposed by typed layer family bases."""
    expected_names = {
        "config_type": {"ConfigT", "_ConfigT"},
        "runtime_state_type": {"RuntimeStateT", "_RuntimeStateT"},
    }[attr_name]
    for base in getattr(layer_type, "__orig_bases__", ()):
        origin = get_origin(base) or base
        args = tuple(_substitute_type(arg, substitutions) for arg in get_args(base))
        if not isinstance(origin, type) or not issubclass(origin, Layer):
            continue

        params = _generic_params(origin)
        for param, arg in zip(params, args):
            if getattr(param, "__name__", None) in expected_names:
                return arg

        next_substitutions = dict(substitutions)
        next_substitutions.update(_generic_arg_substitutions(origin, args))
        inferred = _infer_schema_generic_arg(origin, attr_name, next_substitutions)
        if inferred is not None:
            return inferred
    return None


def _infer_layer_generic_arg(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any]],
    index: int,
    substitutions: Mapping[object, object],
) -> object | None:
    """Infer one concrete ``Layer`` generic argument through inheritance.

    This walks through intermediate generic base classes so subclasses can omit
    explicit class attributes in common cases such as ``class X(Base[YDeps])``.
    """
    for base in getattr(layer_type, "__orig_bases__", ()):
        origin = get_origin(base) or base
        args = tuple(_substitute_type(arg, substitutions) for arg in get_args(base))
        if origin is Layer:
            if len(args) <= index:
                continue
            return args[index]

        if not isinstance(origin, type) or not issubclass(origin, Layer):
            continue

        next_substitutions = dict(substitutions)
        next_substitutions.update(_generic_arg_substitutions(origin, args))
        inferred = _infer_layer_generic_arg(origin, index, next_substitutions)
        if inferred is not None:
            return inferred
    return None


def _init_schema_type(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any]],
    attr_name: str,
    inferred_schema_type: type[BaseModel] | None,
    default_schema_type: type[BaseModel],
) -> None:
    schema_type = layer_type.__dict__.get(attr_name)
    if schema_type is None:
        schema_type = inferred_schema_type or getattr(layer_type, attr_name, default_schema_type)
        setattr(layer_type, attr_name, schema_type)
    if not isinstance(schema_type, type) or not issubclass(schema_type, BaseModel):
        raise TypeError(f"{layer_type.__name__}.{attr_name} must be a Pydantic BaseModel subclass.")


def _init_config_type(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any]],
    inferred_config_type: type[LayerConfig] | None,
) -> None:
    config_type = layer_type.__dict__.get("config_type")
    if config_type is None:
        config_type = inferred_config_type or getattr(layer_type, "config_type", EmptyLayerConfig)
        setattr(layer_type, "config_type", config_type)
    if not isinstance(config_type, type) or not issubclass(config_type, LayerConfig):
        raise TypeError(f"{layer_type.__name__}.config_type must be a LayerConfig subclass.")


def _substitute_type(value: object, substitutions: Mapping[object, object]) -> object:
    if value in substitutions:
        return substitutions[value]

    origin = get_origin(value)
    if origin is None:
        return value

    args = get_args(value)
    if not args:
        return value

    substituted_args = tuple(_substitute_type(arg, substitutions) for arg in args)
    if substituted_args == args:
        return value

    try:
        return origin[substituted_args]
    except TypeError:
        return value


def _generic_arg_substitutions(origin: type[Any], args: Sequence[object]) -> dict[object, object]:
    params = _generic_params(origin)
    return dict(zip(params, args))


def _generic_params(origin: type[Any]) -> Sequence[object]:
    params = getattr(origin, "__type_params__", ())
    if not params:
        params = getattr(origin, "__parameters__", ())
    return params


def _as_deps_type(value: object) -> type[LayerDeps] | None:
    runtime_type = get_origin(value) or value
    if isinstance(runtime_type, type) and issubclass(runtime_type, LayerDeps):
        return runtime_type
    return None


def _as_model_type(value: object) -> type[BaseModel] | None:
    runtime_type = get_origin(value) or value
    if isinstance(runtime_type, type) and issubclass(runtime_type, BaseModel):
        return runtime_type
    return None


def _as_config_type(value: object) -> type[LayerConfig] | None:
    runtime_type = get_origin(value) or value
    if isinstance(runtime_type, type) and issubclass(runtime_type, LayerConfig):
        return runtime_type
    return None


def _is_generic_layer_template(layer_type: type[Layer[Any, Any, Any, Any, Any, Any]]) -> bool:
    return bool(getattr(layer_type, "__type_params__", ())) or bool(getattr(layer_type, "__parameters__", ()))
