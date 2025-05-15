import enum
from typing import Generic, TypeVar

from sqlalchemy import CHAR, VARCHAR, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID


class StringUUID(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return str(value)
        else:
            return value.hex

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)


_E = TypeVar("_E", bound=enum.StrEnum)


class EnumText(TypeDecorator, Generic[_E]):
    impl = VARCHAR
    cache_ok = True

    _length: int
    _enum_class: type[_E]

    def __init__(self, enum_class: type[_E], length: int | None = None):
        self._enum_class = enum_class
        max_enum_value_len = max(len(e.value) for e in enum_class)
        if length is not None:
            if length < max_enum_value_len:
                raise ValueError("length should be greater than enum value length.")
            self._length = length
        else:
            # leave some rooms for future longer enum values.
            self._length = max(max_enum_value_len, 20)

    def process_bind_param(self, value: _E | str | None, dialect):
        if value is None:
            return value
        if isinstance(value, self._enum_class):
            return value.value
        elif isinstance(value, str):
            self._enum_class(value)
            return value
        else:
            raise TypeError(f"expected str or {self._enum_class}, got {type(value)}")

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(VARCHAR(self._length))

    def process_result_value(self, value, dialect) -> _E | None:
        if value is None:
            return value
        if not isinstance(value, str):
            raise TypeError(f"expected str, got {type(value)}")
        return self._enum_class(value)

    def compare_values(self, x, y):
        if x is None or y is None:
            return x is y
        return x == y
