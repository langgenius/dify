from __future__ import annotations

import base64
import io
import pathlib
from collections.abc import Mapping
from datetime import date, datetime
from typing import Any, Literal, TypeVar, cast, get_args, get_type_hints

import anyio
import pydantic
from typing_extensions import override

from .._base_compat import is_typeddict, model_dump
from .._files import is_base64_file_input
from ._typing import (
    extract_type_arg,
    is_annotated_type,
    is_iterable_type,
    is_list_type,
    is_required_type,
    is_union_type,
    strip_annotated_type,
)
from ._utils import (
    is_iterable,
    is_list,
    is_mapping,
)

_T = TypeVar("_T")


# TODO: support for drilling globals() and locals()
# TODO: ensure works correctly with forward references in all cases


PropertyFormat = Literal["iso8601", "base64", "custom"]


class PropertyInfo:
    """Metadata class to be used in Annotated types to provide information about a given type.

    For example:

    class MyParams(TypedDict):
        account_holder_name: Annotated[str, PropertyInfo(alias='accountHolderName')]

    This means that {'account_holder_name': 'Robert'} will be transformed to {'accountHolderName': 'Robert'} before being sent to the API.
    """  # noqa: E501

    alias: str | None
    format: PropertyFormat | None
    format_template: str | None
    discriminator: str | None

    def __init__(
        self,
        *,
        alias: str | None = None,
        format: PropertyFormat | None = None,
        format_template: str | None = None,
        discriminator: str | None = None,
    ) -> None:
        self.alias = alias
        self.format = format
        self.format_template = format_template
        self.discriminator = discriminator

    @override
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(alias='{self.alias}', format={self.format}, format_template='{self.format_template}', discriminator='{self.discriminator}')"  # noqa: E501


def maybe_transform(
    data: object,
    expected_type: object,
) -> Any | None:
    """Wrapper over `transform()` that allows `None` to be passed.

    See `transform()` for more details.
    """
    if data is None:
        return None
    return transform(data, expected_type)


# Wrapper over _transform_recursive providing fake types
def transform(
    data: _T,
    expected_type: object,
) -> _T:
    """Transform dictionaries based off of type information from the given type, for example:

    ```py
    class Params(TypedDict, total=False):
        card_id: Required[Annotated[str, PropertyInfo(alias="cardID")]]


    transformed = transform({"card_id": "<my card ID>"}, Params)
    # {'cardID': '<my card ID>'}
    ```

    Any keys / data that does not have type information given will be included as is.

    It should be noted that the transformations that this function does are not represented in the type system.
    """
    transformed = _transform_recursive(data, annotation=cast(type, expected_type))
    return cast(_T, transformed)


def _get_annotated_type(type_: type) -> type | None:
    """If the given type is an `Annotated` type then it is returned, if not `None` is returned.

    This also unwraps the type when applicable, e.g. `Required[Annotated[T, ...]]`
    """
    if is_required_type(type_):
        # Unwrap `Required[Annotated[T, ...]]` to `Annotated[T, ...]`
        type_ = get_args(type_)[0]

    if is_annotated_type(type_):
        return type_

    return None


def _maybe_transform_key(key: str, type_: type) -> str:
    """Transform the given `data` based on the annotations provided in `type_`.

    Note: this function only looks at `Annotated` types that contain `PropertInfo` metadata.
    """
    annotated_type = _get_annotated_type(type_)
    if annotated_type is None:
        # no `Annotated` definition for this type, no transformation needed
        return key

    # ignore the first argument as it is the actual type
    annotations = get_args(annotated_type)[1:]
    for annotation in annotations:
        if isinstance(annotation, PropertyInfo) and annotation.alias is not None:
            return annotation.alias

    return key


def _transform_recursive(
    data: object,
    *,
    annotation: type,
    inner_type: type | None = None,
) -> object:
    """Transform the given data against the expected type.

    Args:
        annotation: The direct type annotation given to the particular piece of data.
            This may or may not be wrapped in metadata types, e.g. `Required[T]`, `Annotated[T, ...]` etc

        inner_type: If applicable, this is the "inside" type. This is useful in certain cases where the outside type
            is a container type such as `List[T]`. In that case `inner_type` should be set to `T` so that each entry in
            the list can be transformed using the metadata from the container type.

            Defaults to the same value as the `annotation` argument.
    """
    if inner_type is None:
        inner_type = annotation

    stripped_type = strip_annotated_type(inner_type)
    if is_typeddict(stripped_type) and is_mapping(data):
        return _transform_typeddict(data, stripped_type)

    if (
        # List[T]
        (is_list_type(stripped_type) and is_list(data))
        # Iterable[T]
        or (is_iterable_type(stripped_type) and is_iterable(data) and not isinstance(data, str))
    ):
        inner_type = extract_type_arg(stripped_type, 0)
        return [_transform_recursive(d, annotation=annotation, inner_type=inner_type) for d in data]

    if is_union_type(stripped_type):
        # For union types we run the transformation against all subtypes to ensure that everything is transformed.
        #
        # TODO: there may be edge cases where the same normalized field name will transform to two different names
        # in different subtypes.
        for subtype in get_args(stripped_type):
            data = _transform_recursive(data, annotation=annotation, inner_type=subtype)
        return data

    if isinstance(data, pydantic.BaseModel):
        return model_dump(data, exclude_unset=True)

    annotated_type = _get_annotated_type(annotation)
    if annotated_type is None:
        return data

    # ignore the first argument as it is the actual type
    annotations = get_args(annotated_type)[1:]
    for annotation in annotations:
        if isinstance(annotation, PropertyInfo) and annotation.format is not None:
            return _format_data(data, annotation.format, annotation.format_template)

    return data


def _format_data(data: object, format_: PropertyFormat, format_template: str | None) -> object:
    if isinstance(data, date | datetime):
        if format_ == "iso8601":
            return data.isoformat()

        if format_ == "custom" and format_template is not None:
            return data.strftime(format_template)

    if format_ == "base64" and is_base64_file_input(data):
        binary: str | bytes | None = None

        if isinstance(data, pathlib.Path):
            binary = data.read_bytes()
        elif isinstance(data, io.IOBase):
            binary = data.read()

            if isinstance(binary, str):  # type: ignore[unreachable]
                binary = binary.encode()

        if not isinstance(binary, bytes):
            raise RuntimeError(f"Could not read bytes from {data}; Received {type(binary)}")

        return base64.b64encode(binary).decode("ascii")

    return data


def _transform_typeddict(
    data: Mapping[str, object],
    expected_type: type,
) -> Mapping[str, object]:
    result: dict[str, object] = {}
    annotations = get_type_hints(expected_type, include_extras=True)
    for key, value in data.items():
        type_ = annotations.get(key)
        if type_ is None:
            # we do not have a type annotation for this field, leave it as is
            result[key] = value
        else:
            result[_maybe_transform_key(key, type_)] = _transform_recursive(value, annotation=type_)
    return result


async def async_maybe_transform(
    data: object,
    expected_type: object,
) -> Any | None:
    """Wrapper over `async_transform()` that allows `None` to be passed.

    See `async_transform()` for more details.
    """
    if data is None:
        return None
    return await async_transform(data, expected_type)


async def async_transform(
    data: _T,
    expected_type: object,
) -> _T:
    """Transform dictionaries based off of type information from the given type, for example:

    ```py
    class Params(TypedDict, total=False):
        card_id: Required[Annotated[str, PropertyInfo(alias="cardID")]]


    transformed = transform({"card_id": "<my card ID>"}, Params)
    # {'cardID': '<my card ID>'}
    ```

    Any keys / data that does not have type information given will be included as is.

    It should be noted that the transformations that this function does are not represented in the type system.
    """
    transformed = await _async_transform_recursive(data, annotation=cast(type, expected_type))
    return cast(_T, transformed)


async def _async_transform_recursive(
    data: object,
    *,
    annotation: type,
    inner_type: type | None = None,
) -> object:
    """Transform the given data against the expected type.

    Args:
        annotation: The direct type annotation given to the particular piece of data.
            This may or may not be wrapped in metadata types, e.g. `Required[T]`, `Annotated[T, ...]` etc

        inner_type: If applicable, this is the "inside" type. This is useful in certain cases where the outside type
            is a container type such as `List[T]`. In that case `inner_type` should be set to `T` so that each entry in
            the list can be transformed using the metadata from the container type.

            Defaults to the same value as the `annotation` argument.
    """
    if inner_type is None:
        inner_type = annotation

    stripped_type = strip_annotated_type(inner_type)
    if is_typeddict(stripped_type) and is_mapping(data):
        return await _async_transform_typeddict(data, stripped_type)

    if (
        # List[T]
        (is_list_type(stripped_type) and is_list(data))
        # Iterable[T]
        or (is_iterable_type(stripped_type) and is_iterable(data) and not isinstance(data, str))
    ):
        inner_type = extract_type_arg(stripped_type, 0)
        return [await _async_transform_recursive(d, annotation=annotation, inner_type=inner_type) for d in data]

    if is_union_type(stripped_type):
        # For union types we run the transformation against all subtypes to ensure that everything is transformed.
        #
        # TODO: there may be edge cases where the same normalized field name will transform to two different names
        # in different subtypes.
        for subtype in get_args(stripped_type):
            data = await _async_transform_recursive(data, annotation=annotation, inner_type=subtype)
        return data

    if isinstance(data, pydantic.BaseModel):
        return model_dump(data, exclude_unset=True)

    annotated_type = _get_annotated_type(annotation)
    if annotated_type is None:
        return data

    # ignore the first argument as it is the actual type
    annotations = get_args(annotated_type)[1:]
    for annotation in annotations:
        if isinstance(annotation, PropertyInfo) and annotation.format is not None:
            return await _async_format_data(data, annotation.format, annotation.format_template)

    return data


async def _async_format_data(data: object, format_: PropertyFormat, format_template: str | None) -> object:
    if isinstance(data, date | datetime):
        if format_ == "iso8601":
            return data.isoformat()

        if format_ == "custom" and format_template is not None:
            return data.strftime(format_template)

    if format_ == "base64" and is_base64_file_input(data):
        binary: str | bytes | None = None

        if isinstance(data, pathlib.Path):
            binary = await anyio.Path(data).read_bytes()
        elif isinstance(data, io.IOBase):
            binary = data.read()

            if isinstance(binary, str):  # type: ignore[unreachable]
                binary = binary.encode()

        if not isinstance(binary, bytes):
            raise RuntimeError(f"Could not read bytes from {data}; Received {type(binary)}")

        return base64.b64encode(binary).decode("ascii")

    return data


async def _async_transform_typeddict(
    data: Mapping[str, object],
    expected_type: type,
) -> Mapping[str, object]:
    result: dict[str, object] = {}
    annotations = get_type_hints(expected_type, include_extras=True)
    for key, value in data.items():
        type_ = annotations.get(key)
        if type_ is None:
            # we do not have a type annotation for this field, leave it as is
            result[key] = value
        else:
            result[_maybe_transform_key(key, type_)] = await _async_transform_recursive(value, annotation=type_)
    return result
