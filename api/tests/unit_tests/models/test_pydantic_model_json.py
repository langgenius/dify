from collections.abc import Iterator
from typing import Annotated, Literal

import pytest
import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from pydantic_core import PydanticSerializationError
from sqlalchemy import Engine, select
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.sql.sqltypes import TEXT

import models.types as model_types
from models.types import FrozenPydanticModelColumn


class _FrozenStrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    name: str
    attributes: dict[str, str] = Field(default_factory=dict)


class _NamePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    name: str


class _OtherFrozenStrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    name: str


class _MutableStrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_default=True)

    name: str


class _FrozenNonStrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)

    name: str


class _CatPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    kind: Literal["cat"] = "cat"
    lives: int


class _DogPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    kind: Literal["dog"] = "dog"
    breed: str


type _PetPayload = Annotated[_CatPayload | _DogPayload, Field(discriminator="kind")]

_PAYLOAD_TYPE = FrozenPydanticModelColumn(
    _FrozenStrictPayload,
)
_NAME_TYPE = FrozenPydanticModelColumn(_NamePayload)
_PET_TYPE = FrozenPydanticModelColumn(
    TypeAdapter(_PetPayload),
    model_types=(_CatPayload, _DogPayload),
)


class _Base(DeclarativeBase):
    pass


class _PydanticJSONRecord(_Base):
    __tablename__ = "unit_pydantic_json_records"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)
    payload: Mapped[_FrozenStrictPayload | None] = mapped_column(_PAYLOAD_TYPE, nullable=True)
    pet: Mapped[_PetPayload | None] = mapped_column(_PET_TYPE, nullable=True)


@pytest.fixture
def sqlite_pydantic_json_engine() -> Iterator[Engine]:
    engine = sa.create_engine("sqlite:///:memory:")
    _Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        _Base.metadata.drop_all(engine)
        engine.dispose()


def test_frozen_pydantic_model_column_is_publicly_available() -> None:
    assert getattr(model_types, "FrozenPydanticModelColumn", None) is not None


def test_frozen_pydantic_model_column_accepts_a_frozen_strict_model() -> None:
    column_type = FrozenPydanticModelColumn(_FrozenStrictPayload)

    assert column_type.model_types == (_FrozenStrictPayload,)


def test_concrete_model_rejects_explicit_model_types() -> None:
    with pytest.raises(TypeError, match="model_types must not be provided for a concrete model"):
        FrozenPydanticModelColumn(
            _FrozenStrictPayload,
            model_types=(_FrozenStrictPayload,),
        )


def test_type_adapter_requires_explicit_model_types() -> None:
    with pytest.raises(TypeError, match="model_types is required when schema is a TypeAdapter"):
        FrozenPydanticModelColumn(TypeAdapter(_PetPayload))


def test_constructor_rejects_a_model_that_is_not_frozen() -> None:
    with pytest.raises(TypeError, match=r"_MutableStrictPayload.*frozen=True"):
        FrozenPydanticModelColumn(_MutableStrictPayload)


def test_constructor_rejects_a_model_that_is_not_strict() -> None:
    with pytest.raises(TypeError, match=r"_FrozenNonStrictPayload.*strict=True"):
        FrozenPydanticModelColumn(_FrozenNonStrictPayload)


def test_bind_rejects_a_bare_dict() -> None:
    with pytest.raises(TypeError, match=r"value.*_FrozenStrictPayload"):
        _PAYLOAD_TYPE.process_bind_param({"name": "bare-dict"}, sqlite.dialect())


def test_bind_rejects_a_json_string() -> None:
    with pytest.raises(TypeError, match=r"value.*_FrozenStrictPayload"):
        _PAYLOAD_TYPE.process_bind_param('{"name":"json-string"}', sqlite.dialect())


def test_bind_rejects_an_unlisted_frozen_model() -> None:
    with pytest.raises(TypeError, match=r"value.*_FrozenStrictPayload"):
        _PAYLOAD_TYPE.process_bind_param(_OtherFrozenStrictPayload(name="other"), sqlite.dialect())


def test_bind_returns_model_dump_json_output() -> None:
    assert (
        _PAYLOAD_TYPE.process_bind_param(
            _FrozenStrictPayload(name="serialized", attributes={"source": "model_dump_json"}),
            sqlite.dialect(),
        )
        == '{"name":"serialized","attributes":{"source":"model_dump_json"}}'
    )


def test_bind_processor_does_not_double_encode_model_json() -> None:
    bind_processor = _NAME_TYPE.bind_processor(sqlite.dialect())

    assert bind_processor is not None
    assert bind_processor(_NamePayload(name="Alice")) == '{"name":"Alice"}'


def test_bind_treats_serialization_warnings_as_errors() -> None:
    invalid_model = _FrozenStrictPayload.model_construct(name=42, attributes={})

    with pytest.raises(PydanticSerializationError):
        _PAYLOAD_TYPE.process_bind_param(invalid_model, sqlite.dialect())


def test_validation_errors_are_not_swallowed() -> None:
    with pytest.raises(ValidationError):
        _PAYLOAD_TYPE.process_result_value('{"name":42}', sqlite.dialect())


def test_uses_text_compatible_dialect_types() -> None:
    assert isinstance(_NAME_TYPE.load_dialect_impl(postgresql.dialect()), TEXT)
    assert isinstance(_NAME_TYPE.load_dialect_impl(sqlite.dialect()), TEXT)
    assert isinstance(_NAME_TYPE.load_dialect_impl(mysql.dialect()), LONGTEXT)


def test_sqlite_uses_a_text_column(sqlite_pydantic_json_engine: Engine) -> None:
    columns = sa.inspect(sqlite_pydantic_json_engine).get_columns(_PydanticJSONRecord.__tablename__)
    payload_column = next(column for column in columns if column["name"] == "payload")

    assert isinstance(payload_column["type"], TEXT)


def test_sqlite_round_trips_a_concrete_model_and_discriminated_union(
    sqlite_pydantic_json_engine: Engine,
) -> None:
    with Session(sqlite_pydantic_json_engine) as session:
        record = _PydanticJSONRecord(
            payload=_FrozenStrictPayload(name="stored", attributes={"source": "sqlite"}),
            pet=_CatPayload(lives=9),
        )
        session.add(record)
        session.commit()
        record_id = record.id

    with Session(sqlite_pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.payload == _FrozenStrictPayload(name="stored", attributes={"source": "sqlite"})
        assert restored.pet == _CatPayload(lives=9)
        assert isinstance(restored.pet, _CatPayload)


def test_sqlite_round_trips_nullable_values(sqlite_pydantic_json_engine: Engine) -> None:
    with Session(sqlite_pydantic_json_engine) as session:
        record = _PydanticJSONRecord(payload=None, pet=None)
        session.add(record)
        session.commit()
        record_id = record.id

    with Session(sqlite_pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.payload is None
        assert restored.pet is None


def test_replacing_the_whole_model_marks_the_attribute_dirty_and_persists(
    sqlite_pydantic_json_engine: Engine,
) -> None:
    with Session(sqlite_pydantic_json_engine) as session:
        record = _PydanticJSONRecord(payload=_FrozenStrictPayload(name="before"), pet=None)
        session.add(record)
        session.commit()
        record_id = record.id

        record.payload = _FrozenStrictPayload(name="after")

        assert session.is_modified(record)
        session.commit()

    with Session(sqlite_pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.payload == _FrozenStrictPayload(name="after")


def test_frozen_models_remain_shallow_and_nested_mutation_is_not_tracked(
    sqlite_pydantic_json_engine: Engine,
) -> None:
    with Session(sqlite_pydantic_json_engine) as session:
        record = _PydanticJSONRecord(
            payload=_FrozenStrictPayload(name="stored", attributes={"key": "original"}),
            pet=None,
        )
        session.add(record)
        session.commit()
        record_id = record.id

        assert record.payload is not None
        record.payload.attributes["key"] = "mutated"

        assert record.payload.attributes == {"key": "mutated"}
        assert not session.is_modified(record, include_collections=True)
        session.commit()

    with Session(sqlite_pydantic_json_engine) as session:
        restored = session.scalar(select(_PydanticJSONRecord).where(_PydanticJSONRecord.id == record_id))

        assert restored is not None
        assert restored.payload == _FrozenStrictPayload(name="stored", attributes={"key": "original"})
