"""Core layer abstractions and typed dependency binding.

Layers declare their dependency shape with ``Layer[DepsT, PromptT, ToolT, ...]``.
``DepsT`` must be a ``LayerDeps`` subclass whose annotated members are concrete
``Layer`` subclasses or modern optional dependencies such as ``SomeLayer |
None``. The optional trailing generic slots declare Pydantic schemas for config,
serializable runtime state, and live runtime handles. The base class infers
``deps_type`` and schema class attributes from the generic base when possible,
while still allowing subclasses to set them explicitly for unusual inheritance
patterns.

``Layer.bind_deps`` is the mutation point for dependency state. Layer
implementations should treat ``self.deps`` as unavailable until a compositor or
caller has resolved and bound dependencies.

Layer async entry uses a caller-provided ``LayerControl`` as an explicit state
machine and per-session runtime owner. A fresh control starts in
``LifecycleState.NEW`` and enters create logic. A suspended control resumes,
while active or closed controls are rejected to prevent ambiguous nested or
post-delete reuse. Exit behavior is selected per entry with ``ExitIntent`` and
resets to delete on every successful enter. Layer instances are shared graph and
capability definitions, so session-local serializable ids, checkpoints, and
other snapshot data belong in ``LayerControl.runtime_state``; live clients,
connections, and process handles belong in ``LayerControl.runtime_handles``.
Neither category should be stored on ``self`` when it is session-local.

``Layer`` is framework-neutral over system prompt, user prompt, and tool item
types. The native ``prefix_prompts``, ``suffix_prompts``, ``user_prompts``, and
``tools`` properties are the layer authoring surface. ``wrap_prompt``,
``wrap_user_prompt``, and ``wrap_tool`` are the compositor aggregation surface;
typed families such as ``agenton.layers.types.PlainLayer`` implement them to tag
native values without changing layer implementations.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from types import UnionType
from typing import Any, ClassVar, Generic, Mapping, Sequence, Union, cast, get_args, get_origin, get_type_hints

from pydantic import BaseModel, ConfigDict
from typing_extensions import Self, TypeVar


_DepsT = TypeVar("_DepsT", bound="LayerDeps")
_PromptT = TypeVar("_PromptT")
_UserPromptT = TypeVar("_UserPromptT")
_ToolT = TypeVar("_ToolT")
_ConfigT = TypeVar("_ConfigT", bound=BaseModel, default="EmptyLayerConfig")
_RuntimeStateT = TypeVar("_RuntimeStateT", bound=BaseModel, default="EmptyRuntimeState")
_RuntimeHandlesT = TypeVar("_RuntimeHandlesT", bound=BaseModel, default="EmptyRuntimeHandles")


class LayerDeps:
    """Typed dependency container for a Layer.

    Subclasses declare dependency members with annotations. Every annotated
    member must be a Layer subclass or ``LayerSubclass | None``. Optional deps
    are always assigned as attributes; missing optional values become ``None``.
    """

    def __init__(self, **deps: "Layer[Any, Any, Any, Any, Any, Any, Any] | None") -> None:
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


class EmptyLayerConfig(BaseModel):
    """Default serializable config schema for layers without config."""

    model_config = ConfigDict(extra="forbid")


class EmptyRuntimeState(BaseModel):
    """Default serializable per-session runtime state schema."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class EmptyRuntimeHandles(BaseModel):
    """Default live per-session runtime handle schema.

    Handles may contain arbitrary Python objects and are intentionally excluded
    from session snapshots.
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


class LifecycleState(StrEnum):
    """Externally observable lifecycle state for a layer control."""

    NEW = "new"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CLOSED = "closed"


class ExitIntent(StrEnum):
    """Per-entry exit behavior requested for a layer control."""

    DELETE = "delete"
    SUSPEND = "suspend"


@dataclass(slots=True)
class LayerControl(Generic[_RuntimeStateT, _RuntimeHandlesT]):
    """Stateful control slot passed into a layer entry context.

    ``Layer.enter`` requires the caller to provide this object. The control owns
    the layer lifecycle state, the current entry's exit intent, and arbitrary
    per-session runtime state and live handles. Call ``suspend_on_exit`` before leaving the
    context to make a later entry resume; call ``delete_on_exit`` or do nothing
    for the default delete behavior. Store session-local serializable ids,
    checkpoints, and other snapshot data in ``runtime_state``. Store live
    clients, connections, process handles, and other non-serializable objects in
    ``runtime_handles``. Do not put either kind of session-local data on the
    shared layer instance.

    ``runtime_state`` intentionally persists after suspend and delete. Suspend,
    resume, and delete hooks can inspect the same values created on entry, and
    callers may inspect closed-session diagnostics after exit. Reuse is still
    governed by ``state``: a closed control cannot be entered again. Runtime
    handles are not serialized in snapshots and should be rehydrated from
    runtime state in resume hooks.
    """

    state: LifecycleState = LifecycleState.NEW
    exit_intent: ExitIntent = ExitIntent.DELETE
    runtime_state: _RuntimeStateT = field(default_factory=lambda: cast(_RuntimeStateT, EmptyRuntimeState()))
    runtime_handles: _RuntimeHandlesT = field(default_factory=lambda: cast(_RuntimeHandlesT, EmptyRuntimeHandles()))

    def suspend_on_exit(self) -> None:
        """Request suspend behavior when the current layer entry exits."""
        self.exit_intent = ExitIntent.SUSPEND

    def delete_on_exit(self) -> None:
        """Request delete behavior when the current layer entry exits."""
        self.exit_intent = ExitIntent.DELETE


@dataclass(frozen=True, slots=True)
class LayerDepSpec:
    """Runtime dependency specification derived from a deps annotation."""

    layer_type: type["Layer[Any, Any, Any, Any, Any, Any, Any]"]
    optional: bool = False


class Layer(
    ABC,
    Generic[_DepsT, _PromptT, _UserPromptT, _ToolT, _ConfigT, _RuntimeStateT, _RuntimeHandlesT],
):
    """Framework-neutral base class for prompt/tool layers.

    Subclasses expose optional prompt fragments and tools through typed
    properties. They declare required dependencies in the ``DepsT`` container
    rather than by accepting dependencies in ``__init__``. Layer instances can be
    entered by multiple sessions, including concurrently, so lifecycle hooks
    should store session-local runtime values on the passed ``LayerControl``.
    The default async context manager handles create, resume, suspend, and
    delete transitions; layers can override ``enter`` when they need to wrap
    extra runtime resources.
    """

    deps_type: type[_DepsT]
    deps: _DepsT
    type_id: ClassVar[str | None] = None
    config_type: ClassVar[type[BaseModel]] = EmptyLayerConfig
    runtime_state_type: ClassVar[type[BaseModel]] = EmptyRuntimeState
    runtime_handles_type: ClassVar[type[BaseModel]] = EmptyRuntimeHandles

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
        _init_schema_type(cls, "config_type", _infer_schema_type(cls, 4, "config_type"), EmptyLayerConfig)
        _init_schema_type(
            cls,
            "runtime_state_type",
            _infer_schema_type(cls, 5, "runtime_state_type"),
            EmptyRuntimeState,
        )
        _init_schema_type(
            cls,
            "runtime_handles_type",
            _infer_schema_type(cls, 6, "runtime_handles_type"),
            EmptyRuntimeHandles,
        )

    @classmethod
    def from_config(cls: type[Self], config: _ConfigT) -> Self:
        """Create a layer from schema-validated serialized config.

        Registries/builders validate raw config with ``config_type`` before
        calling this method. Layers are not config-constructible by default.
        Subclasses that accept config should override this method and consume
        the typed Pydantic model for their schema.
        """
        raise TypeError(f"{cls.__name__} cannot be created from config.")

    @classmethod
    def dependency_names(cls) -> frozenset[str]:
        """Return dependency field names declared by this layer's deps schema."""
        return frozenset(_get_dep_specs(cls.deps_type))

    def new_control(
        self,
        *,
        state: LifecycleState = LifecycleState.NEW,
        runtime_state: object | None = None,
    ) -> LayerControl[_RuntimeStateT, _RuntimeHandlesT]:
        """Create a schema-validated per-session control for this layer.

        ``runtime_state`` is validated through ``runtime_state_type`` and live
        handles are always initialized empty through ``runtime_handles_type``.
        """
        raw_runtime_state = {} if runtime_state is None else runtime_state
        return LayerControl(
            state=state,
            exit_intent=ExitIntent.DELETE,
            runtime_state=cast(_RuntimeStateT, self.runtime_state_type.model_validate(raw_runtime_state)),
            runtime_handles=cast(_RuntimeHandlesT, self.runtime_handles_type.model_validate({})),
        )

    def bind_deps(self, deps: Mapping[str, "Layer[Any, Any, Any, Any, Any, Any, Any] | None"]) -> None:
        """Bind this layer's declared dependencies from a name-to-layer mapping.

        The mapping may include more layers than the declared dependency fields.
        Only names declared by ``deps_type`` are selected and validated. Missing
        optional deps are bound as ``None``.
        """
        resolved_deps: dict[str, Layer[Any, Any, Any, Any, Any, Any, Any] | None] = {}
        for name, spec in _get_dep_specs(self.deps_type).items():
            if name not in deps:
                if spec.optional:
                    resolved_deps[name] = None
                    continue
                raise ValueError(
                    f"Dependency '{name}' is required for layer '{type(self).__name__}' but not provided."
                )
            resolved_deps[name] = deps[name]
        self.deps = self.deps_type(**resolved_deps)

    def enter(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> AbstractAsyncContextManager[None]:
        """Return the layer's async entry context manager.

        ``control`` is the lifecycle control slot for this entry. Subclasses can
        override this to wrap extra async resources around
        ``self.lifecycle_enter(control)``.
        """
        return self.lifecycle_enter(control)

    @asynccontextmanager
    async def lifecycle_enter(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> AsyncIterator[None]:
        """Run the default explicit lifecycle state machine for one entry."""
        if control.state is LifecycleState.NEW:
            control.exit_intent = ExitIntent.DELETE
            await self.on_context_create(control)
            control.state = LifecycleState.ACTIVE
        elif control.state is LifecycleState.SUSPENDED:
            control.exit_intent = ExitIntent.DELETE
            await self.on_context_resume(control)
            control.state = LifecycleState.ACTIVE
        elif control.state is LifecycleState.ACTIVE:
            raise RuntimeError(
                "LayerControl is already active; duplicate or nested enter is not allowed."
            )
        elif control.state is LifecycleState.CLOSED:
            raise RuntimeError(
                "LayerControl is closed; create a new compositor session before entering again."
            )

        try:
            yield
        finally:
            if control.exit_intent is ExitIntent.SUSPEND:
                await self.on_context_suspend(control)
                control.state = LifecycleState.SUSPENDED
            else:
                await self.on_context_delete(control)
                control.state = LifecycleState.CLOSED

    async def on_context_create(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> None:
        """Run when the layer context is entered from ``LifecycleState.NEW``."""

    async def on_context_delete(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> None:
        """Run when the layer context exits with ``ExitIntent.DELETE``."""

    async def on_context_suspend(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> None:
        """Run when the layer context exits with ``ExitIntent.SUSPEND``."""

    async def on_context_resume(self, control: LayerControl[_RuntimeStateT, _RuntimeHandlesT]) -> None:
        """Run when the layer context enters from ``LifecycleState.SUSPENDED``."""

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
        """Wrap a native prompt item for compositor aggregation."""
        raise NotImplementedError

    @abstractmethod
    def wrap_user_prompt(self, prompt: _UserPromptT) -> object:
        """Wrap a native user prompt item for compositor aggregation."""
        raise NotImplementedError

    @abstractmethod
    def wrap_tool(self, tool: _ToolT) -> object:
        """Wrap a native tool item for compositor aggregation."""
        raise NotImplementedError


def _get_dep_specs(deps_type: type[LayerDeps]) -> dict[str, LayerDepSpec]:
    dep_specs: dict[str, LayerDepSpec] = {}
    for name, annotation in get_type_hints(deps_type).items():
        spec = _as_dep_spec(annotation)
        if spec is None:
            raise TypeError(
                f"{deps_type.__name__}.{name} must be annotated with a Layer subclass "
                "or Layer subclass | None."
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


def _as_layer_type(annotation: object) -> type[Layer[Any, Any, Any, Any, Any, Any, Any]] | None:
    runtime_type = get_origin(annotation) or annotation
    if isinstance(runtime_type, type) and issubclass(runtime_type, Layer):
        return cast(type[Layer[Any, Any, Any, Any, Any, Any, Any]], runtime_type)
    return None


def _infer_deps_type(layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]]) -> type[LayerDeps] | None:
    inferred = _infer_layer_generic_arg(layer_type, 0, {})
    if inferred is None:
        return None
    return _as_deps_type(inferred)


def _infer_schema_type(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]],
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


def _infer_schema_generic_arg(
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]],
    attr_name: str,
    substitutions: Mapping[object, object],
) -> object | None:
    """Infer schema type arguments exposed by typed layer family bases."""
    expected_names = {
        "config_type": {"ConfigT", "_ConfigT"},
        "runtime_state_type": {"RuntimeStateT", "_RuntimeStateT"},
        "runtime_handles_type": {"RuntimeHandlesT", "_RuntimeHandlesT"},
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
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]],
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
    layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]],
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


def _is_generic_layer_template(layer_type: type[Layer[Any, Any, Any, Any, Any, Any, Any]]) -> bool:
    return bool(getattr(layer_type, "__type_params__", ())) or bool(
        getattr(layer_type, "__parameters__", ())
    )
