import enum
import uuid
from typing import Any, Generic, TypeVar

from sqlalchemy import CHAR, VARCHAR, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.sql.type_api import TypeEngine


class StringUUID(TypeDecorator[uuid.UUID | str | None]):
    impl = CHAR
    cache_ok = True

    def process_bind_param(self, value: uuid.UUID | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return str(value)
        else:
            if isinstance(value, uuid.UUID):
                return value.hex
            return value

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_result_value(self, value: uuid.UUID | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return str(value)


_E = TypeVar("_E", bound=enum.StrEnum)


class EnumText(TypeDecorator[_E | None], Generic[_E]):
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

    def process_bind_param(self, value: _E | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        if isinstance(value, self._enum_class):
            return value.value
        # Since _E is bound to StrEnum which inherits from str, at this point value must be str
        self._enum_class(value)
        return value

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        return dialect.type_descriptor(VARCHAR(self._length))

    def process_result_value(self, value: str | None, dialect: Dialect) -> _E | None:
        if value is None:
            return value
        # Type annotation guarantees value is str at this point
        return self._enum_class(value)

    def compare_values(self, x: _E | None, y: _E | None) -> bool:
        if x is None or y is None:
            return x is y
        return x == y
