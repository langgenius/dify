from __future__ import annotations

import functools
import inspect
import os
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import (
    Any,
    TypeGuard,
    TypeVar,
    Union,
    cast,
    overload,
)

import sniffio

from .._base_compat import parse_date as parse_date  # noqa: PLC0414
from .._base_compat import parse_datetime as parse_datetime  # noqa: PLC0414
from .._base_type import FileTypes, Headers, HeadersLike, NotGiven, NotGivenOr


def remove_notgiven_indict(obj):
    if obj is None or (not isinstance(obj, Mapping)):
        return obj
    return {key: value for key, value in obj.items() if not isinstance(value, NotGiven)}


_T = TypeVar("_T")
_TupleT = TypeVar("_TupleT", bound=tuple[object, ...])
_MappingT = TypeVar("_MappingT", bound=Mapping[str, object])
_SequenceT = TypeVar("_SequenceT", bound=Sequence[object])
CallableT = TypeVar("CallableT", bound=Callable[..., Any])


def flatten(t: Iterable[Iterable[_T]]) -> list[_T]:
    return [item for sublist in t for item in sublist]


def extract_files(
    # TODO: this needs to take Dict but variance issues.....
    # create protocol type ?
    query: Mapping[str, object],
    *,
    paths: Sequence[Sequence[str]],
) -> list[tuple[str, FileTypes]]:
    """Recursively extract files from the given dictionary based on specified paths.

    A path may look like this ['foo', 'files', '<array>', 'data'].

    Note: this mutates the given dictionary.
    """
    files: list[tuple[str, FileTypes]] = []
    for path in paths:
        files.extend(_extract_items(query, path, index=0, flattened_key=None))
    return files


def _extract_items(
    obj: object,
    path: Sequence[str],
    *,
    index: int,
    flattened_key: str | None,
) -> list[tuple[str, FileTypes]]:
    try:
        key = path[index]
    except IndexError:
        if isinstance(obj, NotGiven):
            # no value was provided - we can safely ignore
            return []

        # cyclical import
        from .._files import assert_is_file_content

        # We have exhausted the path, return the entry we found.
        assert_is_file_content(obj, key=flattened_key)
        assert flattened_key is not None
        return [(flattened_key, cast(FileTypes, obj))]

    index += 1
    if is_dict(obj):
        try:
            # We are at the last entry in the path so we must remove the field
            if (len(path)) == index:
                item = obj.pop(key)
            else:
                item = obj[key]
        except KeyError:
            # Key was not present in the dictionary, this is not indicative of an error
            # as the given path may not point to a required field. We also do not want
            # to enforce required fields as the API may differ from the spec in some cases.
            return []
        if flattened_key is None:
            flattened_key = key
        else:
            flattened_key += f"[{key}]"
        return _extract_items(
            item,
            path,
            index=index,
            flattened_key=flattened_key,
        )
    elif is_list(obj):
        if key != "<array>":
            return []

        return flatten(
            [
                _extract_items(
                    item,
                    path,
                    index=index,
                    flattened_key=flattened_key + "[]" if flattened_key is not None else "[]",
                )
                for item in obj
            ]
        )

    # Something unexpected was passed, just ignore it.
    return []


def is_given(obj: NotGivenOr[_T]) -> TypeGuard[_T]:
    return not isinstance(obj, NotGiven)


# Type safe methods for narrowing types with TypeVars.
# The default narrowing for isinstance(obj, dict) is dict[unknown, unknown],
# however this cause Pyright to rightfully report errors. As we know we don't
# care about the contained types we can safely use `object` in it's place.
#
# There are two separate functions defined, `is_*` and `is_*_t` for different use cases.
# `is_*` is for when you're dealing with an unknown input
# `is_*_t` is for when you're narrowing a known union type to a specific subset


def is_tuple(obj: object) -> TypeGuard[tuple[object, ...]]:
    return isinstance(obj, tuple)


def is_tuple_t(obj: _TupleT | object) -> TypeGuard[_TupleT]:
    return isinstance(obj, tuple)


def is_sequence(obj: object) -> TypeGuard[Sequence[object]]:
    return isinstance(obj, Sequence)


def is_sequence_t(obj: _SequenceT | object) -> TypeGuard[_SequenceT]:
    return isinstance(obj, Sequence)


def is_mapping(obj: object) -> TypeGuard[Mapping[str, object]]:
    return isinstance(obj, Mapping)


def is_mapping_t(obj: _MappingT | object) -> TypeGuard[_MappingT]:
    return isinstance(obj, Mapping)


def is_dict(obj: object) -> TypeGuard[dict[object, object]]:
    return isinstance(obj, dict)


def is_list(obj: object) -> TypeGuard[list[object]]:
    return isinstance(obj, list)


def is_iterable(obj: object) -> TypeGuard[Iterable[object]]:
    return isinstance(obj, Iterable)


def deepcopy_minimal(item: _T) -> _T:
    """Minimal reimplementation of copy.deepcopy() that will only copy certain object types:

    - mappings, e.g. `dict`
    - list

    This is done for performance reasons.
    """
    if is_mapping(item):
        return cast(_T, {k: deepcopy_minimal(v) for k, v in item.items()})
    if is_list(item):
        return cast(_T, [deepcopy_minimal(entry) for entry in item])
    return item


# copied from https://github.com/Rapptz/RoboDanny
def human_join(seq: Sequence[str], *, delim: str = ", ", final: str = "or") -> str:
    size = len(seq)
    if size == 0:
        return ""

    if size == 1:
        return seq[0]

    if size == 2:
        return f"{seq[0]} {final} {seq[1]}"

    return delim.join(seq[:-1]) + f" {final} {seq[-1]}"


def quote(string: str) -> str:
    """Add single quotation marks around the given string. Does *not* do any escaping."""
    return f"'{string}'"


def required_args(*variants: Sequence[str]) -> Callable[[CallableT], CallableT]:
    """Decorator to enforce a given set of arguments or variants of arguments are passed to the decorated function.

    Useful for enforcing runtime validation of overloaded functions.

    Example usage:
    ```py
    @overload
    def foo(*, a: str) -> str:
        ...


    @overload
    def foo(*, b: bool) -> str:
        ...


    # This enforces the same constraints that a static type checker would
    # i.e. that either a or b must be passed to the function
    @required_args(["a"], ["b"])
    def foo(*, a: str | None = None, b: bool | None = None) -> str:
        ...
    ```
    """

    def inner(func: CallableT) -> CallableT:
        params = inspect.signature(func).parameters
        positional = [
            name
            for name, param in params.items()
            if param.kind
            in {
                param.POSITIONAL_ONLY,
                param.POSITIONAL_OR_KEYWORD,
            }
        ]

        @functools.wraps(func)
        def wrapper(*args: object, **kwargs: object) -> object:
            given_params: set[str] = set()
            for i, _ in enumerate(args):
                try:
                    given_params.add(positional[i])
                except IndexError:
                    raise TypeError(
                        f"{func.__name__}() takes {len(positional)} argument(s) but {len(args)} were given"
                    ) from None

            given_params.update(kwargs.keys())

            for variant in variants:
                matches = all(param in given_params for param in variant)
                if matches:
                    break
            else:  # no break
                if len(variants) > 1:
                    variations = human_join(
                        ["(" + human_join([quote(arg) for arg in variant], final="and") + ")" for variant in variants]
                    )
                    msg = f"Missing required arguments; Expected either {variations} arguments to be given"
                else:
                    # TODO: this error message is not deterministic
                    missing = list(set(variants[0]) - given_params)
                    if len(missing) > 1:
                        msg = f"Missing required arguments: {human_join([quote(arg) for arg in missing])}"
                    else:
                        msg = f"Missing required argument: {quote(missing[0])}"
                raise TypeError(msg)
            return func(*args, **kwargs)

        return wrapper  # type: ignore

    return inner


_K = TypeVar("_K")
_V = TypeVar("_V")


@overload
def strip_not_given(obj: None) -> None: ...


@overload
def strip_not_given(obj: Mapping[_K, _V | NotGiven]) -> dict[_K, _V]: ...


@overload
def strip_not_given(obj: object) -> object: ...


def strip_not_given(obj: object | None) -> object:
    """Remove all top-level keys where their values are instances of `NotGiven`"""
    if obj is None:
        return None

    if not is_mapping(obj):
        return obj

    return {key: value for key, value in obj.items() if not isinstance(value, NotGiven)}


def coerce_integer(val: str) -> int:
    return int(val, base=10)


def coerce_float(val: str) -> float:
    return float(val)


def coerce_boolean(val: str) -> bool:
    return val in {"true", "1", "on"}


def maybe_coerce_integer(val: str | None) -> int | None:
    if val is None:
        return None
    return coerce_integer(val)


def maybe_coerce_float(val: str | None) -> float | None:
    if val is None:
        return None
    return coerce_float(val)


def maybe_coerce_boolean(val: str | None) -> bool | None:
    if val is None:
        return None
    return coerce_boolean(val)


def removeprefix(string: str, prefix: str) -> str:
    """Remove a prefix from a string.

    Backport of `str.removeprefix` for Python < 3.9
    """
    if string.startswith(prefix):
        return string[len(prefix) :]
    return string


def removesuffix(string: str, suffix: str) -> str:
    """Remove a suffix from a string.

    Backport of `str.removesuffix` for Python < 3.9
    """
    if string.endswith(suffix):
        return string[: -len(suffix)]
    return string


def file_from_path(path: str) -> FileTypes:
    contents = Path(path).read_bytes()
    file_name = os.path.basename(path)
    return (file_name, contents)


def get_required_header(headers: HeadersLike, header: str) -> str:
    lower_header = header.lower()
    if isinstance(headers, Mapping):
        headers = cast(Headers, headers)
        for k, v in headers.items():
            if k.lower() == lower_header and isinstance(v, str):
                return v

    """ to deal with the case where the header looks like Stainless-Event-Id """
    intercaps_header = re.sub(r"([^\w])(\w)", lambda pat: pat.group(1) + pat.group(2).upper(), header.capitalize())

    for normalized_header in [header, lower_header, header.upper(), intercaps_header]:
        value = headers.get(normalized_header)
        if value:
            return value

    raise ValueError(f"Could not find {header} header")


def get_async_library() -> str:
    try:
        return sniffio.current_async_library()
    except Exception:
        return "false"


def drop_prefix_image_data(content: Union[str, list[dict]]) -> Union[str, list[dict]]:
    """
    删除 ;base64, 前缀
    :param image_data:
    :return:
    """
    if isinstance(content, list):
        for data in content:
            if data.get("type") == "image_url":
                image_data = data.get("image_url").get("url")
                if image_data.startswith("data:image/"):
                    image_data = image_data.split("base64,")[-1]
                    data["image_url"]["url"] = image_data

    return content
