from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Generic, TypeVar, Union, cast, overload

import pydantic
from pydantic.fields import FieldInfo
from typing_extensions import Self

from ._base_type import StrBytesIntFloat

_T = TypeVar("_T")
_ModelT = TypeVar("_ModelT", bound=pydantic.BaseModel)

# --------------- Pydantic v2 compatibility ---------------

# Pyright incorrectly reports some of our functions as overriding a method when they don't
# pyright: reportIncompatibleMethodOverride=false

PYDANTIC_V2 = pydantic.VERSION.startswith("2.")

# v1 re-exports
if TYPE_CHECKING:

    def parse_date(value: date | StrBytesIntFloat) -> date: ...

    def parse_datetime(value: Union[datetime, StrBytesIntFloat]) -> datetime: ...

    def get_args(t: type[Any]) -> tuple[Any, ...]: ...

    def is_union(tp: type[Any] | None) -> bool: ...

    def get_origin(t: type[Any]) -> type[Any] | None: ...

    def is_literal_type(type_: type[Any]) -> bool: ...

    def is_typeddict(type_: type[Any]) -> bool: ...

else:
    if PYDANTIC_V2:
        from pydantic.v1.typing import (  # noqa: I001
            get_args as get_args,  # noqa: PLC0414
            is_union as is_union,  # noqa: PLC0414
            get_origin as get_origin,  # noqa: PLC0414
            is_typeddict as is_typeddict,  # noqa: PLC0414
            is_literal_type as is_literal_type,  # noqa: PLC0414
        )
        from pydantic.v1.datetime_parse import parse_date as parse_date, parse_datetime as parse_datetime  # noqa: PLC0414
    else:
        from pydantic.typing import (  # noqa: I001
            get_args as get_args,  # noqa: PLC0414
            is_union as is_union,  # noqa: PLC0414
            get_origin as get_origin,  # noqa: PLC0414
            is_typeddict as is_typeddict,  # noqa: PLC0414
            is_literal_type as is_literal_type,  # noqa: PLC0414
        )
        from pydantic.datetime_parse import parse_date as parse_date, parse_datetime as parse_datetime  # noqa: PLC0414


# refactored config
if TYPE_CHECKING:
    from pydantic import ConfigDict
else:
    if PYDANTIC_V2:
        from pydantic import ConfigDict
    else:
        # TODO: provide an error message here?
        ConfigDict = None


# renamed methods / properties
def parse_obj(model: type[_ModelT], value: object) -> _ModelT:
    if PYDANTIC_V2:
        return model.model_validate(value)
    else:
        # pyright: ignore[reportDeprecated, reportUnnecessaryCast]
        return cast(_ModelT, model.parse_obj(value))


def field_is_required(field: FieldInfo) -> bool:
    if PYDANTIC_V2:
        return field.is_required()
    return field.required  # type: ignore


def field_get_default(field: FieldInfo) -> Any:
    value = field.get_default()
    if PYDANTIC_V2:
        from pydantic_core import PydanticUndefined

        if value == PydanticUndefined:
            return None
        return value
    return value


def field_outer_type(field: FieldInfo) -> Any:
    if PYDANTIC_V2:
        return field.annotation
    return field.outer_type_  # type: ignore


def get_model_config(model: type[pydantic.BaseModel]) -> Any:
    if PYDANTIC_V2:
        return model.model_config
    return model.__config__  # type: ignore


def get_model_fields(model: type[pydantic.BaseModel]) -> dict[str, FieldInfo]:
    if PYDANTIC_V2:
        return model.model_fields
    return model.__fields__  # type: ignore


def model_copy(model: _ModelT) -> _ModelT:
    if PYDANTIC_V2:
        return model.model_copy()
    return model.copy()  # type: ignore


def model_json(model: pydantic.BaseModel, *, indent: int | None = None) -> str:
    if PYDANTIC_V2:
        return model.model_dump_json(indent=indent)
    return model.json(indent=indent)  # type: ignore


def model_dump(
    model: pydantic.BaseModel,
    *,
    exclude_unset: bool = False,
    exclude_defaults: bool = False,
) -> dict[str, Any]:
    if PYDANTIC_V2:
        return model.model_dump(
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
        )
    return cast(
        "dict[str, Any]",
        model.dict(  # pyright: ignore[reportDeprecated, reportUnnecessaryCast]
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
        ),
    )


def model_parse(model: type[_ModelT], data: Any) -> _ModelT:
    if PYDANTIC_V2:
        return model.model_validate(data)
    return model.parse_obj(data)  # pyright: ignore[reportDeprecated]


# generic models
if TYPE_CHECKING:

    class GenericModel(pydantic.BaseModel): ...

else:
    if PYDANTIC_V2:
        # there no longer needs to be a distinction in v2 but
        # we still have to create our own subclass to avoid
        # inconsistent MRO ordering errors
        class GenericModel(pydantic.BaseModel): ...

    else:
        import pydantic.generics

        class GenericModel(pydantic.generics.GenericModel, pydantic.BaseModel): ...


# cached properties
if TYPE_CHECKING:
    cached_property = property

    # we define a separate type (copied from typeshed)
    # that represents that `cached_property` is `set`able
    # at runtime, which differs from `@property`.
    #
    # this is a separate type as editors likely special case
    # `@property` and we don't want to cause issues just to have
    # more helpful internal types.

    class typed_cached_property(Generic[_T]):  # noqa: N801
        func: Callable[[Any], _T]
        attrname: str | None

        def __init__(self, func: Callable[[Any], _T]) -> None: ...

        @overload
        def __get__(self, instance: None, owner: type[Any] | None = None) -> Self: ...

        @overload
        def __get__(self, instance: object, owner: type[Any] | None = None) -> _T: ...

        def __get__(self, instance: object, owner: type[Any] | None = None) -> _T | Self:
            raise NotImplementedError()

        def __set_name__(self, owner: type[Any], name: str) -> None: ...

        # __set__ is not defined at runtime, but @cached_property is designed to be settable
        def __set__(self, instance: object, value: _T) -> None: ...
else:
    try:
        from functools import cached_property
    except ImportError:
        from cached_property import cached_property

    typed_cached_property = cached_property
