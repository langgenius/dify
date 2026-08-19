"""Dynamic plain-tool layer with object-bound tool entries.

This module builds on ``ObjectLayer`` from ``agenton_collections.plain.basic``.
Plain callables are exposed unchanged, while entries wrapped with
``with_object`` bind the current object value into the first callable argument
and expose the remaining parameters as the public tool signature.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import wraps
from inspect import Parameter, Signature, iscoroutinefunction, signature
from types import UnionType
from typing import (
    Annotated,
    Any,
    Concatenate,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)

from agenton.layers.base import LayerDeps
from agenton.layers.types import PlainLayer
from agenton_collections.layers.plain.basic import ObjectLayer

type _ObjectToolCallable[ObjectT] = Callable[Concatenate[ObjectT, ...], Any]


@dataclass(frozen=True, slots=True)
class _ObjectToolEntry[ObjectT]:
    """Tool entry whose first argument should be filled from ``ObjectLayer``."""

    tool_entry: _ObjectToolCallable[ObjectT]
    object_type: type[ObjectT] | None = None


type _DynamicToolEntry[ObjectT] = Callable[..., Any] | _ObjectToolEntry[ObjectT]


def with_object[ObjectT](
    object_type: type[ObjectT],
    /,
) -> Callable[[_ObjectToolCallable[ObjectT]], _ObjectToolEntry[ObjectT]]:
    """Mark a tool as requiring the bound object value as its first argument."""

    def decorator(tool_entry: _ObjectToolCallable[ObjectT]) -> _ObjectToolEntry[ObjectT]:
        _validate_object_tool_annotation(tool_entry, object_type)
        return _ObjectToolEntry(tool_entry=tool_entry, object_type=object_type)

    return decorator


class DynamicToolsLayerDeps[ObjectT](LayerDeps):
    """Dependencies required by ``DynamicToolsLayer``."""

    object_layer: ObjectLayer[ObjectT]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass
class DynamicToolsLayer[ObjectT](PlainLayer[DynamicToolsLayerDeps[ObjectT]]):
    """Layer that exposes plain tools and object-bound tools."""

    tool_entries: Sequence[_DynamicToolEntry[ObjectT]] = ()

    @property
    def tools(self) -> list[Callable[..., Any]]:
        object_value = self.deps.object_layer.value
        return [
            _bind_object_argument(tool_entry.tool_entry, object_value, tool_entry.object_type)
            if isinstance(tool_entry, _ObjectToolEntry)
            else tool_entry
            for tool_entry in self.tool_entries
        ]


def _bind_object_argument[ObjectT](
    tool_entry: _ObjectToolCallable[ObjectT],
    object_value: ObjectT,
    object_type: type[ObjectT] | None,
) -> Callable[..., Any]:
    _validate_object_value(tool_entry, object_value, object_type)
    if iscoroutinefunction(tool_entry):
        wrapped = _async_object_wrapper(tool_entry, object_value)
    else:
        wrapped = _sync_object_wrapper(tool_entry, object_value)

    public_signature = _public_tool_signature(tool_entry)
    if public_signature is not None:
        setattr(wrapped, "__signature__", public_signature)
    _set_public_annotations(wrapped, tool_entry)
    return wrapped


def _validate_object_tool_annotation[ObjectT](
    tool_entry: _ObjectToolCallable[ObjectT],
    object_type: type[ObjectT],
) -> None:
    parameter = _first_object_parameter(tool_entry)
    if parameter is None:
        return

    annotation = _parameter_annotation(tool_entry, parameter)
    if annotation is Parameter.empty:
        return
    if _annotation_accepts_object_type(annotation, object_type):
        return

    raise TypeError(
        f"Object-bound tool '{_tool_name(tool_entry)}' first parameter should accept '{_type_name(object_type)}'."
    )


def _first_object_parameter(tool_entry: Callable[..., Any]) -> Parameter | None:
    try:
        tool_signature = signature(tool_entry)
    except (TypeError, ValueError):
        return None

    parameters = list(tool_signature.parameters.values())
    if not parameters:
        raise ValueError("Dynamic tools must accept the object dependency as their first parameter.")
    return parameters[0]


def _parameter_annotation(tool_entry: Callable[..., Any], parameter: Parameter) -> object:
    try:
        type_hints = get_type_hints(tool_entry, include_extras=True)
    except (AttributeError, NameError, TypeError):
        return parameter.annotation
    return type_hints.get(parameter.name, parameter.annotation)


def _annotation_accepts_object_type(annotation: object, object_type: type[Any]) -> bool:
    if annotation is Any or annotation is Parameter.empty:
        return True

    origin = get_origin(annotation)
    if origin is Annotated:
        args = get_args(annotation)
        return True if not args else _annotation_accepts_object_type(args[0], object_type)
    if origin in (UnionType, Union):
        return any(
            arg is type(None) or _annotation_accepts_object_type(arg, object_type) for arg in get_args(annotation)
        )

    runtime_type = origin or annotation
    if not isinstance(runtime_type, type):
        return True
    try:
        return issubclass(object_type, runtime_type)
    except TypeError:
        return True


def _validate_object_value[ObjectT](
    tool_entry: _ObjectToolCallable[ObjectT],
    object_value: ObjectT,
    object_type: type[ObjectT] | None,
) -> None:
    if object_type is None or isinstance(object_value, object_type):
        return
    raise TypeError(
        f"Object-bound tool '{_tool_name(tool_entry)}' expected object dependency "
        f"of type '{_type_name(object_type)}', but got '{type(object_value).__qualname__}'."
    )


def _tool_name(tool_entry: Callable[..., Any]) -> str:
    return getattr(tool_entry, "__qualname__", getattr(tool_entry, "__name__", repr(tool_entry)))


def _type_name(object_type: type[Any]) -> str:
    return object_type.__qualname__


def _sync_object_wrapper[ObjectT](
    tool_entry: _ObjectToolCallable[ObjectT],
    object_value: ObjectT,
) -> Callable[..., Any]:
    @wraps(tool_entry)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        return tool_entry(object_value, *args, **kwargs)

    return wrapped


def _async_object_wrapper[ObjectT](
    tool_entry: _ObjectToolCallable[ObjectT],
    object_value: ObjectT,
) -> Callable[..., Any]:
    @wraps(tool_entry)
    async def wrapped(*args: Any, **kwargs: Any) -> Any:
        return await tool_entry(object_value, *args, **kwargs)

    return wrapped


def _public_tool_signature(tool_entry: Callable[..., Any]) -> Signature | None:
    try:
        tool_signature = signature(tool_entry)
    except (TypeError, ValueError):
        return None

    parameters = list(tool_signature.parameters.values())
    if not parameters:
        raise ValueError("Dynamic tools must accept the object dependency as their first parameter.")
    return tool_signature.replace(parameters=parameters[1:])


def _set_public_annotations(wrapper: Callable[..., Any], tool_entry: Callable[..., Any]) -> None:
    annotations = getattr(tool_entry, "__annotations__", None)
    if not isinstance(annotations, dict):
        return

    try:
        parameters = list(signature(tool_entry).parameters)
    except (TypeError, ValueError):
        parameters = []

    public_annotations = dict(annotations)
    if parameters:
        public_annotations.pop(parameters[0], None)
    wrapper.__annotations__ = public_annotations


__all__ = [
    "DynamicToolsLayer",
    "DynamicToolsLayerDeps",
    "with_object",
]
