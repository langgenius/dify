import enum
import uuid
from typing import Any, Generic, TypeVar

import sqlalchemy as sa
from sqlalchemy import CHAR, TEXT, VARCHAR, LargeBinary, TypeDecorator
from sqlalchemy.dialects.mysql import LONGBLOB, LONGTEXT
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.sql.type_api import TypeEngine

from configs import dify_config


class StringUUID(TypeDecorator[uuid.UUID | str | None]):
    impl = CHAR
    cache_ok = True

    def process_bind_param(self, value: uuid.UUID | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        elif dialect.name in ["postgresql", "mysql"]:
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


class LongText(TypeDecorator[str | None]):
    impl = TEXT
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return value

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(TEXT())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(LONGTEXT())
        else:
            return dialect.type_descriptor(TEXT())

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return value


class BinaryData(TypeDecorator[bytes | None]):
    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        if value is None:
            return value
        return value

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(BYTEA())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(LONGBLOB())
        else:
            return dialect.type_descriptor(LargeBinary())

    def process_result_value(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        if value is None:
            return value
        return value


class AdjustedJSON(TypeDecorator[dict | list | None]):
    impl = sa.JSON
    cache_ok = True

    def __init__(self, astext_type=None):
        self.astext_type = astext_type
        super().__init__()

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            if self.astext_type:
                return dialect.type_descriptor(JSONB(astext_type=self.astext_type))
            else:
                return dialect.type_descriptor(JSONB())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(sa.JSON())
        else:
            return dialect.type_descriptor(sa.JSON())

    def process_bind_param(self, value: dict | list | None, dialect: Dialect) -> dict | list | None:
        return value

    def process_result_value(self, value: dict | list | None, dialect: Dialect) -> dict | list | None:
        return value


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


def adjusted_json_index(index_name, column_name):
    index_name = index_name or f"{column_name}_idx"
    if dify_config.DB_TYPE == "postgresql":
        return sa.Index(index_name, column_name, postgresql_using="gin")
    else:
        return None
