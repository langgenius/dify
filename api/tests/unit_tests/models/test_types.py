import pytest
from pydantic import BaseModel
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql.sqltypes import TEXT

import models.types as model_types
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


def test_json_model_column_resolves_model_class_from_import_path():
    column = JSONModelColumn("tests.unit_tests.models.test_types.JsonColumnSample")

    assert column.process_bind_param({"name": "path", "count": 6}, sqlite.dialect()) == '{"count":6,"name":"path"}'
    assert column._model_class is JsonColumnSample


def test_json_model_column_rejects_import_path_that_is_not_pydantic_model():
    column = JSONModelColumn("tests.unit_tests.models.test_types.NotPydanticModel")

    with pytest.raises(TypeError, match="must be a Pydantic BaseModel subclass"):
        column.process_bind_param({"name": "bad"}, sqlite.dialect())


def test_json_model_column_uses_long_text_compatible_dialect_types():
    column = JSONModelColumn(JsonColumnSample)

    assert isinstance(column.load_dialect_impl(postgresql.dialect()), TEXT)
    assert isinstance(column.load_dialect_impl(sqlite.dialect()), TEXT)
    assert isinstance(column.load_dialect_impl(mysql.dialect()), LONGTEXT)


def test_json_model_column_accepts_late_bound_type_objects():
    column = JSONModelColumn(JsonColumnSample)
    column._model_class = None
    column._model_class_or_path = JsonColumnSample

    assert column._resolve_model_class() is JsonColumnSample


def test_json_model_column_uses_importlib_for_string_model_paths(monkeypatch):
    imported = {}
    real_import_module = model_types.importlib.import_module

    def capture_import(module_path: str):
        imported["module_path"] = module_path
        return real_import_module(module_path)

    monkeypatch.setattr(model_types.importlib, "import_module", capture_import)
    column = JSONModelColumn("tests.unit_tests.models.test_types.JsonColumnSample")

    assert column._resolve_model_class() is JsonColumnSample
    assert imported["module_path"] == "tests.unit_tests.models.test_types"
