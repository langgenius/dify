from typing import cast

import pytest
from pydantic import BaseModel
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql.sqltypes import TEXT

from models.types import JSONModelColumn


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
