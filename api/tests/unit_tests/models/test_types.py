from typing import cast

import pytest
from pydantic import BaseModel
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql.sqltypes import TEXT

from graphon.model_runtime.entities.model_entities import ModelType
from models.types import EnumText, JSONModelColumn, parse_enum_text


class JsonColumnSample(BaseModel):
    name: str
    count: int = 0


class NotPydanticModel:
    pass


def test_json_model_column_serializes_supported_input_shapes():
    column = JSONModelColumn(JsonColumnSample)
    dialect = sqlite.dialect()

    assert column.process_bind_param(None, dialect) is None
    assert column.process_bind_param(JsonColumnSample(name="model", count=2), dialect) == '{"count":2,"name":"model"}'
    assert column.process_bind_param({"name": "dict", "count": 3}, dialect) == '{"count":3,"name":"dict"}'
    assert column.process_bind_param('{"name":"json","count":4}', dialect) == '{"count":4,"name":"json"}'


def test_json_model_column_deserializes_empty_and_json_values():
    column = JSONModelColumn(JsonColumnSample)
    dialect = sqlite.dialect()

    assert column.process_result_value(None, dialect) is None
    assert column.process_result_value("", dialect) is None
    assert column.process_result_value('{"name":"stored","count":5}', dialect) == JsonColumnSample(
        name="stored",
        count=5,
    )


def test_json_model_column_keeps_model_class_directly():
    column = JSONModelColumn(JsonColumnSample)

    assert column.process_bind_param({"name": "class", "count": 6}, sqlite.dialect()) == '{"count":6,"name":"class"}'
    assert column._model_class is JsonColumnSample


def test_json_model_column_rejects_non_pydantic_model_class():
    with pytest.raises(TypeError, match="must be a Pydantic BaseModel subclass"):
        JSONModelColumn(cast(type[BaseModel], NotPydanticModel))


def test_json_model_column_uses_long_text_compatible_dialect_types():
    column = JSONModelColumn(JsonColumnSample)

    assert isinstance(column.load_dialect_impl(postgresql.dialect()), TEXT)
    assert isinstance(column.load_dialect_impl(sqlite.dialect()), TEXT)
    assert isinstance(column.load_dialect_impl(mysql.dialect()), LONGTEXT)


def test_json_model_column_rejects_string_model_paths():
    with pytest.raises(TypeError):
        JSONModelColumn(cast(type[BaseModel], "tests.unit_tests.models.test_types.JsonColumnSample"))


def test_parse_enum_text_maps_pre_1_15_model_type_aliases():
    assert parse_enum_text(ModelType, "text-generation") is ModelType.LLM
    assert parse_enum_text(ModelType, "embeddings") is ModelType.TEXT_EMBEDDING
    assert parse_enum_text(ModelType, "reranking") is ModelType.RERANK
    assert parse_enum_text(ModelType, "llm") is ModelType.LLM
    assert parse_enum_text(ModelType, ModelType.LLM) is ModelType.LLM


def test_parse_enum_text_rejects_unknown_values():
    with pytest.raises(ValueError, match="not a valid ModelType"):
        parse_enum_text(ModelType, "not-a-type")


def test_enum_text_reads_legacy_model_type_aliases_but_does_not_bind_them():
    column = EnumText(ModelType)
    dialect = sqlite.dialect()

    assert column.process_result_value("text-generation", dialect) is ModelType.LLM
    assert column.process_result_value("embeddings", dialect) is ModelType.TEXT_EMBEDDING
    assert column.process_result_value("reranking", dialect) is ModelType.RERANK
    assert column.process_bind_param(ModelType.LLM, dialect) == "llm"

    with pytest.raises(ValueError, match="not a valid ModelType"):
        column.process_bind_param("text-generation", dialect)
