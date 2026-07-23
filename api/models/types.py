import enum
import json
import uuid
from typing import Any, cast, overload, override

import sqlalchemy as sa
from pydantic import BaseModel, TypeAdapter
from sqlalchemy import CHAR, TEXT, VARCHAR, LargeBinary, TypeDecorator
from sqlalchemy.dialects.mysql import LONGBLOB, LONGTEXT
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.sql.type_api import TypeEngine
from typing_extensions import deprecated

from configs import dify_config


class StringUUID(TypeDecorator[uuid.UUID | str | None]):
    impl = CHAR
    cache_ok = True

    @override
    def process_bind_param(self, value: uuid.UUID | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        elif dialect.name in ["postgresql", "mysql"]:
            return str(value)
        else:
            if isinstance(value, uuid.UUID):
                return value.hex
            return value

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    @override
    def process_result_value(self, value: uuid.UUID | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return str(value)


class LongText(TypeDecorator[str | None]):
    impl = TEXT
    cache_ok = True

    @override
    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return value

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(TEXT())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(LONGTEXT())
        else:
            return dialect.type_descriptor(TEXT())

    @override
    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        return value


@deprecated("Use FrozenPydanticModelColumn instead.")
class JSONModelColumn[T: BaseModel](TypeDecorator[T | None]):
    """Store a Pydantic model as dialect-adjusted LongText JSON.

    Deprecated: use ``FrozenPydanticModelColumn`` for new columns.
    """

    impl = TEXT
    cache_ok = True

    _model_class: type[T]

    def __init__(self, model_class: type[T]):
        if not issubclass(model_class, BaseModel):
            raise TypeError(f"{model_class.__module__}.{model_class.__name__} must be a Pydantic BaseModel subclass")
        self._model_class = model_class
        super().__init__()

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(TEXT())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(LONGTEXT())
        else:
            return dialect.type_descriptor(TEXT())

    @override
    def process_bind_param(self, value: T | dict[str, Any] | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        match value:
            case _ if isinstance(value, self._model_class):
                model = value
            case str():
                model = self._model_class.model_validate_json(value)
            case _:
                model = self._model_class.model_validate(value)
        return json.dumps(model.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @override
    def process_result_value(self, value: str | None, dialect: Dialect) -> T | None:
        if value is None or value == "":
            return None
        return self._model_class.model_validate_json(value)


class BinaryData(TypeDecorator[bytes | None]):
    impl = LargeBinary
    cache_ok = True

    @override
    def process_bind_param(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        if value is None:
            return value
        return value

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(BYTEA())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(LONGBLOB())
        else:
            return dialect.type_descriptor(LargeBinary())

    @override
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

    @override
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

    @override
    def process_bind_param(
        self, value: dict[str, Any] | list[Any] | None, dialect: Dialect
    ) -> dict[str, Any] | list[Any] | None:
        return value

    @override
    def process_result_value(
        self, value: dict[str, Any] | list[Any] | None, dialect: Dialect
    ) -> dict[str, Any] | list[Any] | None:
        return value


class FrozenPydanticModelColumn[T: BaseModel](TypeDecorator[T]):
    """Persist a frozen Pydantic model as JSON in a dialect-adjusted text column.

    Binding serializes the accepted model directly with
    ``model_dump_json(warnings="error")``. Loading validates the stored JSON in
    strict mode and lets Pydantic validation errors propagate to the caller.
    Pass a concrete model class for concrete models. For discriminated unions,
    pass a ``TypeAdapter`` together with every allowed concrete model class.

    The backing type is ``TEXT`` on PostgreSQL and SQLite and ``LONGTEXT`` on
    MySQL. This is intentional: ``model_dump_json`` already returns JSON text,
    while passing that string through SQLAlchemy's ``JSON`` type would encode it
    again and persist a JSON string scalar instead of the model's JSON object.

    SQLAlchemy does not track in-place changes made inside a Pydantic model, so
    this type only accepts models configured with ``frozen=True``. Persisted
    values must be updated by constructing a new model and assigning it to the
    ORM attribute as a whole, for example ``record.payload = PayloadModel(...)``.
    Otherwise the attribute may not be marked dirty and the change may not be
    persisted.

    Pydantic freezing is shallow: nested mutable containers such as ``dict`` and
    ``list`` can still be changed in place. Callers must treat nested values as
    immutable too instead of mutating paths such as
    ``record.payload.root["key"]``. Supporting nested in-place mutation would
    require SQLAlchemy's Mutable extension or explicit deep change tracking,
    which this type does not provide.
    """

    impl = TEXT
    cache_ok = True

    _model_type: type[T] | None
    _adapter: TypeAdapter[T] | None
    model_types: tuple[type[BaseModel], ...]

    @overload
    def __init__(
        self,
        model_type: type[T],
        /,
    ) -> None: ...

    @overload
    def __init__(
        self,
        adapter: TypeAdapter[T],
        /,
        *,
        model_types: tuple[type[BaseModel], ...],
    ) -> None: ...

    def __init__(
        self,
        schema: type[T] | TypeAdapter[T],
        /,
        *,
        model_types: tuple[type[BaseModel], ...] | None = None,
    ) -> None:
        if isinstance(schema, TypeAdapter):
            if model_types is None:
                raise TypeError("model_types is required when schema is a TypeAdapter")
            if not model_types:
                raise ValueError("model_types must not be empty")
            self._model_type = None
            self._adapter = schema
            self.model_types = model_types
        else:
            if model_types is not None:
                raise TypeError("model_types must not be provided for a concrete model")
            self._model_type = schema
            self._adapter = None
            self.model_types = (schema,)

        for allowed_model_type in self.model_types:
            if not isinstance(allowed_model_type, type) or not issubclass(allowed_model_type, BaseModel):
                raise TypeError("model_types must contain only Pydantic BaseModel classes")
            model_name = f"{allowed_model_type.__module__}.{allowed_model_type.__qualname__}"
            if allowed_model_type.model_config.get("frozen") is not True:
                raise TypeError(f"{model_name} must configure frozen=True")
            if allowed_model_type.model_config.get("strict") is not True:
                raise TypeError(f"{model_name} must configure strict=True")
        super().__init__()

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "mysql":
            return dialect.type_descriptor(LONGTEXT())
        return dialect.type_descriptor(TEXT())

    @override
    def process_bind_param(self, value: object | None, dialect: Dialect) -> str | None:
        del dialect
        if value is None:
            return None
        if not isinstance(value, BaseModel) or not isinstance(value, self.model_types):
            allowed_model_names = ", ".join(model_type.__name__ for model_type in self.model_types)
            raise TypeError(f"value must be one of these Pydantic models: {allowed_model_names}")
        return value.model_dump_json(warnings="error")

    @override
    def process_result_value(self, value: str | bytes | bytearray | None, dialect: Dialect) -> T | None:
        del dialect
        if value is None:
            return None
        if self._model_type is not None:
            return self._model_type.model_validate_json(value, strict=True)
        if self._adapter is None:
            raise RuntimeError("Pydantic JSON validator is not configured")
        return self._adapter.validate_json(value, strict=True)


class EnumText[T: enum.StrEnum](TypeDecorator[T | None]):
    impl = VARCHAR
    cache_ok = True

    _length: int
    _enum_class: type[T]

    def __init__(self, enum_class: type[T], length: int | None = None):
        self._enum_class = enum_class
        max_enum_value_len = max(len(e.value) for e in enum_class)
        if length is not None:
            if length < max_enum_value_len:
                raise ValueError("length should be greater than enum value length.")
            self._length = length
        else:
            # leave some rooms for future longer enum values.
            self._length = max(max_enum_value_len, 20)

    @override
    def process_bind_param(self, value: T | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return value
        if isinstance(value, self._enum_class):
            return value.value
        # Since T is bound to StrEnum which inherits from str, at this point value must be str
        self._enum_class(value)
        return value

    @override
    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        return dialect.type_descriptor(VARCHAR(self._length))

    @override
    def process_result_value(self, value: str | None, dialect: Dialect) -> T | None:
        if value is None or value == "":
            return None
        try:
            # Type annotation guarantees value is str at this point
            return self._enum_class(value)
        except ValueError:
            value_of = getattr(self._enum_class, "value_of", None)
            if callable(value_of):
                return cast(T, value_of(value))
            raise

    @override
    def compare_values(self, x: T | None, y: T | None) -> bool:
        if x is None or y is None:
            return x is y
        return x == y


def adjusted_json_index(index_name, column_name):
    index_name = index_name or f"{column_name}_idx"
    if dify_config.DB_TYPE == "postgresql":
        return sa.Index(index_name, column_name, postgresql_using="gin")
    else:
        return None
