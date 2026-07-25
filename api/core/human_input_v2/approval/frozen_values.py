"""Recursively immutable JSON values used by frozen form snapshots.

Domain code never receives mutable dictionaries from persistence or provider
boundaries. Explicit conversion methods create fresh primitive containers only
when a caller crosses such a boundary.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite

type JSONScalar = str | int | float | bool | None
type JSONPrimitive = JSONScalar | list[JSONPrimitive] | dict[str, JSONPrimitive]
type FrozenJSONValue = JSONScalar | FrozenJSONArray | FrozenJSONObject


def _freeze_json(value: object) -> FrozenJSONValue:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError("JSON numbers must be finite")
        return value
    if isinstance(value, Mapping):
        return FrozenJSONObject.from_mapping(value)
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return FrozenJSONArray(tuple(_freeze_json(item) for item in value))
    raise TypeError(f"unsupported JSON value type: {type(value).__name__}")


def _thaw_json(value: FrozenJSONValue) -> JSONPrimitive:
    if isinstance(value, FrozenJSONObject):
        return value.to_mapping()
    if isinstance(value, FrozenJSONArray):
        return value.to_list()
    return value


@dataclass(frozen=True, slots=True)
class FrozenJSONArray:
    """Immutable JSON array with an explicit primitive conversion boundary."""

    values: tuple[FrozenJSONValue, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.values, tuple):
            raise TypeError("frozen JSON array values must be an immutable tuple")

    def to_list(self) -> list[JSONPrimitive]:
        return [_thaw_json(value) for value in self.values]


@dataclass(frozen=True, slots=True)
class FrozenJSONObject:
    """Immutable ordered JSON object independent from Pydantic and ORM types."""

    entries: tuple[tuple[str, FrozenJSONValue], ...]

    def __post_init__(self) -> None:
        if not isinstance(self.entries, tuple):
            raise TypeError("frozen JSON object entries must be an immutable tuple")
        seen_keys: set[str] = set()
        for key, _value in self.entries:
            if not isinstance(key, str):
                raise TypeError("JSON objects require string keys")
            if key in seen_keys:
                raise ValueError(f"duplicate JSON object key: {key}")
            seen_keys.add(key)

    @classmethod
    def from_mapping(cls, values: Mapping[str, object]) -> FrozenJSONObject:
        entries: list[tuple[str, FrozenJSONValue]] = []
        for key in sorted(values, key=lambda candidate: str(candidate)):
            if not isinstance(key, str):
                raise TypeError("JSON objects require string keys")
            entries.append((key, _freeze_json(values[key])))
        return cls(tuple(entries))

    def to_mapping(self) -> dict[str, JSONPrimitive]:
        return {key: _thaw_json(value) for key, value in self.entries}
