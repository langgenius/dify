import dataclasses
import datetime
from collections import defaultdict, deque
from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal
from enum import Enum
from ipaddress import (
    IPv4Address,
    IPv4Interface,
    IPv4Network,
    IPv6Address,
    IPv6Interface,
    IPv6Network,
)
from pathlib import Path, PurePath
from re import Pattern
from types import GeneratorType
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic.networks import AnyUrl, NameEmail
from pydantic.types import SecretBytes, SecretStr
from pydantic_core import Url
from pydantic_extra_types.color import Color


def model_dump(
    model: BaseModel,
    mode: Literal["json", "python"] = "json",
    **kwargs: Any,
) -> Any:
    return model.model_dump(mode=mode, **kwargs)


# Taken from Pydantic v1 as is
def isoformat(o: datetime.date | datetime.time) -> str:
    return o.isoformat()


# Taken from Pydantic v1 as is. `jsonable_encoder` handles raw `Decimal`
# instances separately when string-preserving JSON output is required.
def decimal_encoder(dec_value: Decimal) -> int | float:
    """Encodes a Decimal as int of there's no exponent, otherwise float

    This is useful when we use ConstrainedDecimal to represent Numeric(x,0)
    where a integer (but not int typed) is used. Encoding this as a float
    results in failed round-tripping between encode and parse.
    Our Id type is a prime example of this.

    >>> decimal_encoder(Decimal("1.0"))
    1.0

    >>> decimal_encoder(Decimal("1"))
    1

    Returns:
        An `int` for integral decimals, otherwise a `float`.

    """
    exponent = dec_value.as_tuple().exponent
    if isinstance(exponent, int) and exponent >= 0:
        return int(dec_value)
    return float(dec_value)


ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
    bytes: lambda o: o.decode(),
    Color: str,
    datetime.date: isoformat,
    datetime.datetime: isoformat,
    datetime.time: isoformat,
    datetime.timedelta: lambda td: td.total_seconds(),
    Decimal: decimal_encoder,
    Enum: lambda o: o.value,
    frozenset: list,
    deque: list,
    GeneratorType: list,
    IPv4Address: str,
    IPv4Interface: str,
    IPv4Network: str,
    IPv6Address: str,
    IPv6Interface: str,
    IPv6Network: str,
    NameEmail: str,
    Path: str,
    Pattern: lambda o: o.pattern,
    SecretBytes: str,
    SecretStr: str,
    set: list,
    UUID: str,
    Url: str,
    AnyUrl: str,
}


def generate_encoders_by_class_tuples(
    type_encoder_map: Mapping[type[Any], Callable[[Any], Any]],
) -> dict[Callable[[Any], Any], tuple[Any, ...]]:
    encoders_by_class_tuples: dict[Callable[[Any], Any], tuple[Any, ...]] = defaultdict(
        tuple,
    )
    for type_, encoder in type_encoder_map.items():
        encoders_by_class_tuples[encoder] += (type_,)
    return encoders_by_class_tuples


encoders_by_class_tuples = generate_encoders_by_class_tuples(ENCODERS_BY_TYPE)
_ENCODER_UNSET = object()


def _encode_with_custom_encoder(
    obj: Any,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]],
) -> Any:
    if type(obj) in custom_encoder:
        return custom_encoder[type(obj)](obj)
    for encoder_type, encoder_instance in custom_encoder.items():
        if isinstance(obj, encoder_type):
            return encoder_instance(obj)
    return _ENCODER_UNSET


def _encode_pydantic_model(
    obj: BaseModel,
    *,
    by_alias: bool,
    exclude_unset: bool,
    exclude_defaults: bool,
    exclude_none: bool,
    excluded_key_prefixes: Sequence[str],
) -> Any:
    obj_dict = model_dump(
        obj,
        mode="json",
        include=None,
        exclude=None,
        by_alias=by_alias,
        exclude_unset=exclude_unset,
        exclude_none=exclude_none,
        exclude_defaults=exclude_defaults,
    )
    if "__root__" in obj_dict:
        obj_dict = obj_dict["__root__"]
    return jsonable_encoder(
        obj_dict,
        exclude_none=exclude_none,
        exclude_defaults=exclude_defaults,
        excluded_key_prefixes=excluded_key_prefixes,
    )


def _encode_dataclass(
    obj: Any,
    *,
    by_alias: bool,
    exclude_unset: bool,
    exclude_defaults: bool,
    exclude_none: bool,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]],
    excluded_key_prefixes: Sequence[str],
) -> Any:
    obj_dict = dataclasses.asdict(obj)
    return jsonable_encoder(
        obj_dict,
        by_alias=by_alias,
        exclude_unset=exclude_unset,
        exclude_defaults=exclude_defaults,
        exclude_none=exclude_none,
        custom_encoder=custom_encoder,
        excluded_key_prefixes=excluded_key_prefixes,
    )


def _encode_mapping(
    obj: Mapping[Any, Any],
    *,
    by_alias: bool,
    exclude_unset: bool,
    exclude_none: bool,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]],
    excluded_key_prefixes: Sequence[str],
) -> dict[Any, Any]:
    encoded_dict = {}
    for key, value in obj.items():
        if isinstance(key, str) and any(
            key.startswith(prefix) for prefix in excluded_key_prefixes
        ):
            continue
        if value is None and exclude_none:
            continue

        encoded_key = jsonable_encoder(
            key,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_none=exclude_none,
            custom_encoder=custom_encoder,
            excluded_key_prefixes=excluded_key_prefixes,
        )
        encoded_value = jsonable_encoder(
            value,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_none=exclude_none,
            custom_encoder=custom_encoder,
            excluded_key_prefixes=excluded_key_prefixes,
        )
        encoded_dict[encoded_key] = encoded_value
    return encoded_dict


def _encode_collection(
    obj: list[Any]
    | set[Any]
    | frozenset[Any]
    | GeneratorType
    | tuple[Any, ...]
    | deque,
    *,
    by_alias: bool,
    exclude_unset: bool,
    exclude_defaults: bool,
    exclude_none: bool,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]],
    excluded_key_prefixes: Sequence[str],
) -> list[Any]:
    return [
        jsonable_encoder(
            item,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
            custom_encoder=custom_encoder,
            excluded_key_prefixes=excluded_key_prefixes,
        )
        for item in obj
    ]


def _find_type_encoder(obj: Any) -> Callable[[Any], Any] | None:
    if type(obj) in ENCODERS_BY_TYPE:
        return ENCODERS_BY_TYPE[type(obj)]
    for encoder, classes_tuple in encoders_by_class_tuples.items():
        if isinstance(obj, classes_tuple):
            return encoder
    return None


def _coerce_mapping_like(obj: Any) -> Any:
    try:
        return dict(obj)
    except (TypeError, ValueError) as dict_error:
        errors = [dict_error]
        try:
            return vars(obj)
        except TypeError as vars_error:
            errors.append(vars_error)
            raise ValueError(str(errors)) from vars_error


def _encode_default_object(
    obj: Any,
    *,
    by_alias: bool,
    exclude_unset: bool,
    exclude_defaults: bool,
    exclude_none: bool,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]],
    excluded_key_prefixes: Sequence[str],
) -> Any:
    type_encoder = _find_type_encoder(obj)
    if type_encoder is not None:
        return type_encoder(obj)

    data = _coerce_mapping_like(obj)
    return jsonable_encoder(
        data,
        by_alias=by_alias,
        exclude_unset=exclude_unset,
        exclude_defaults=exclude_defaults,
        exclude_none=exclude_none,
        custom_encoder=custom_encoder,
        excluded_key_prefixes=excluded_key_prefixes,
    )


def jsonable_encoder(
    obj: Any,
    by_alias: bool = True,
    exclude_unset: bool = False,
    exclude_defaults: bool = False,
    exclude_none: bool = False,
    custom_encoder: Mapping[type[Any], Callable[[Any], Any]] | None = None,
    excluded_key_prefixes: Sequence[str] = (),
) -> Any:
    custom_encoder = custom_encoder or {}
    result = _encode_with_custom_encoder(obj, custom_encoder)
    if result is _ENCODER_UNSET:
        match obj:
            case BaseModel():
                result = _encode_pydantic_model(
                    obj,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_defaults=exclude_defaults,
                    exclude_none=exclude_none,
                    excluded_key_prefixes=excluded_key_prefixes,
                )
            case _ if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
                result = _encode_dataclass(
                    obj,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_defaults=exclude_defaults,
                    exclude_none=exclude_none,
                    custom_encoder=custom_encoder,
                    excluded_key_prefixes=excluded_key_prefixes,
                )
            case Enum():
                result = obj.value
            case PurePath():
                result = str(obj)
            case None | bool() | str() | int() | float():
                result = obj
            case Decimal():
                result = format(obj, "f")
            case dict():
                result = _encode_mapping(
                    obj,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_none=exclude_none,
                    custom_encoder=custom_encoder,
                    excluded_key_prefixes=excluded_key_prefixes,
                )
            case list() | set() | frozenset() | GeneratorType() | tuple() | deque():
                result = _encode_collection(
                    obj,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_defaults=exclude_defaults,
                    exclude_none=exclude_none,
                    custom_encoder=custom_encoder,
                    excluded_key_prefixes=excluded_key_prefixes,
                )
            case _:
                result = _encode_default_object(
                    obj,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_defaults=exclude_defaults,
                    exclude_none=exclude_none,
                    custom_encoder=custom_encoder,
                    excluded_key_prefixes=excluded_key_prefixes,
                )
    return result
