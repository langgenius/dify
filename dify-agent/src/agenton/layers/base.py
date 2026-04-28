"""Core layer abstractions and typed dependency binding.

Layers declare their dependency shape with ``Layer[DepsT, PromptT, ToolT]``.
``DepsT`` must be a ``LayerDeps`` subclass whose annotated members are concrete
``Layer`` subclasses or modern optional dependencies such as ``SomeLayer |
None``. The base class infers ``deps_type`` from the generic base when possible,
while still allowing subclasses to set ``deps_type`` explicitly for unusual
inheritance patterns.

``Layer.bind_deps`` is the mutation point for dependency state. Layer
implementations should treat ``self.deps`` as unavailable until a compositor or
caller has resolved and bound dependencies.

Layer async entry uses a caller-provided bool control to distinguish permanent
exits from temporary exits. The control is also the external lifecycle state:
reuse a ``tmp_leave`` control to reenter, or pass a fresh control to start from
create logic.

``Layer`` is framework-neutral over prompt and tool item types. Typed families
such as ``agenton.layers.types.PlainLayer`` bind those generic slots to a
specific contract without pushing framework types into this base module.
"""

from abc import ABC
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from types import UnionType
from typing import Any, Mapping, Sequence, Union, cast, get_args, get_origin, get_type_hints

from typing_extensions import Self


class LayerDeps:
    """Typed dependency container for a Layer.

    Subclasses declare dependency members with annotations. Every annotated
    member must be a Layer subclass or ``LayerSubclass | None``. Optional deps
    are always assigned as attributes; missing optional values become ``None``.
    """

    def __init__(self, **deps: "Layer[Any, Any, Any] | None") -> None:
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


@dataclass(slots=True)
class LayerControl:
    """Control slot passed into a layer entry context.

    ``Layer.enter`` requires the caller to provide this object. Set
    ``tmp_leave`` before leaving the context to run temporary-leave logic
    instead of delete logic. Reusing that same control on a later entry will
    consume ``tmp_leave`` and run reenter logic; using a fresh control starts
    from create logic.
    """

    tmp_leave: bool = False


@dataclass(frozen=True, slots=True)
class LayerDepSpec:
    """Runtime dependency specification derived from a deps annotation."""

    layer_type: type["Layer[Any, Any, Any]"]
    optional: bool = False


class Layer[DepsT: LayerDeps, PromptT, ToolT](ABC):
    """Framework-neutral base class for prompt/tool layers.

    Subclasses expose optional prompt fragments and tools through typed
    properties. They declare required dependencies in the ``DepsT`` container
    rather than by accepting dependencies in ``__init__``. The default async
    context manager handles create, delete, temporary-leave, and reenter
    transitions; layers can override ``enter`` when they need to wrap extra
    runtime resources.
    """

    deps_type: type[DepsT]
    deps: DepsT

    def __init_subclass__(cls) -> None:
        super().__init_subclass__()
        deps_type = cls.__dict__.get("deps_type")
        if deps_type is None:
            deps_type = _infer_deps_type(cls) or getattr(cls, "deps_type", None)
            if deps_type is None and _is_generic_layer_template(cls):
                return
            if deps_type is not None:
                cls.deps_type = deps_type  # pyright: ignore[reportAttributeAccessIssue]
        if deps_type is None:
            raise TypeError(f"{cls.__name__} must define deps_type or inherit from Layer[DepsT].")
        if not isinstance(deps_type, type) or not issubclass(deps_type, LayerDeps):
            raise TypeError(f"{cls.__name__}.deps_type must be a LayerDeps subclass.")
        _get_dep_specs(deps_type)

    @classmethod
    def from_config(cls: type[Self], config: Any) -> Self:
        """Create a layer from serialized config.

        Layers are not config-constructible by default. Subclasses that accept
        config should override this method and validate dynamic input before
        constructing the layer.
        """
        raise TypeError(f"{cls.__name__} cannot be created from config.")

    def bind_deps(self, deps: Mapping[str, "Layer[Any, Any, Any] | None"]) -> None:
        """Bind this layer's declared dependencies from a name-to-layer mapping.

        The mapping may include more layers than the declared dependency fields.
        Only names declared by ``deps_type`` are selected and validated. Missing
        optional deps are bound as ``None``.
        """
        resolved_deps: dict[str, Layer[Any, Any, Any] | None] = {}
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

    def enter(self, control: LayerControl) -> AbstractAsyncContextManager[None]:
        """Return the layer's async entry context manager.

        ``control`` is the lifecycle control slot for this entry. Subclasses can
        override this to wrap extra async resources around
        ``self.lifecycle_enter(control)``.
        """
        return self.lifecycle_enter(control)

    @asynccontextmanager
    async def lifecycle_enter(self, control: LayerControl) -> AsyncIterator[None]:
        """Run the default create/reenter and delete/temporary-leave lifecycle."""
        was_tmp_left = control.tmp_leave
        control.tmp_leave = False
        if was_tmp_left:
            await self.on_context_reenter(control)
        else:
            await self.on_context_create(control)

        try:
            yield
        finally:
            if control.tmp_leave:
                await self.on_context_tmp_leave(control)
            else:
                await self.on_context_delete(control)

    async def on_context_create(self, control: LayerControl) -> None:
        """Run when the layer context is entered from a non-temporary state."""

    async def on_context_delete(self, control: LayerControl) -> None:
        """Run when the layer context exits without ``tmp_leave`` set."""

    async def on_context_tmp_leave(self, control: LayerControl) -> None:
        """Run when the layer context exits with ``tmp_leave`` set."""

    async def on_context_reenter(self, control: LayerControl) -> None:
        """Run when the layer context enters after a temporary leave."""

    @property
    def prefix_prompts(self) -> Sequence[PromptT]:
        return []

    @property
    def suffix_prompts(self) -> Sequence[PromptT]:
        return []

    @property
    def tools(self) -> Sequence[ToolT]:
        return []


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


def _as_layer_type(annotation: object) -> type[Layer[Any, Any, Any]] | None:
    runtime_type = get_origin(annotation) or annotation
    if isinstance(runtime_type, type) and issubclass(runtime_type, Layer):
        return cast(type[Layer[Any, Any, Any]], runtime_type)
    return None


def _infer_deps_type(layer_type: type[Layer[Any, Any, Any]]) -> type[LayerDeps] | None:
    return _infer_deps_type_from_bases(layer_type, {})


def _infer_deps_type_from_bases(
    layer_type: type[Layer[Any, Any, Any]],
    substitutions: Mapping[object, object],
) -> type[LayerDeps] | None:
    """Infer the concrete deps container through generic Layer inheritance.

    This walks through intermediate generic base classes so subclasses can omit
    an explicit ``deps_type`` in common cases such as ``class X(Base[YDeps])``.
    """
    for base in getattr(layer_type, "__orig_bases__", ()):
        origin = get_origin(base) or base
        args = tuple(_substitute_type(arg, substitutions) for arg in get_args(base))
        if origin is Layer:
            if not args:
                continue
            return _as_deps_type(args[0])

        if not isinstance(origin, type) or not issubclass(origin, Layer):
            continue

        next_substitutions = dict(substitutions)
        next_substitutions.update(_generic_arg_substitutions(origin, args))
        inferred = _infer_deps_type_from_bases(origin, next_substitutions)
        if inferred is not None:
            return inferred
    return None


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
    params = getattr(origin, "__type_params__", ())
    if not params:
        params = getattr(origin, "__parameters__", ())
    return dict(zip(params, args))


def _as_deps_type(value: object) -> type[LayerDeps] | None:
    runtime_type = get_origin(value) or value
    if isinstance(runtime_type, type) and issubclass(runtime_type, LayerDeps):
        return runtime_type
    return None


def _is_generic_layer_template(layer_type: type[Layer[Any, Any, Any]]) -> bool:
    return bool(getattr(layer_type, "__type_params__", ())) or bool(
        getattr(layer_type, "__parameters__", ())
    )
