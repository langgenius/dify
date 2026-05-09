import sys
from enum import StrEnum
from typing import Literal
from unittest.mock import MagicMock, patch

import pytest
from flask_restx import Namespace
from pydantic import BaseModel, ConfigDict, Field


class UserModel(BaseModel):
    id: int
    name: str


class ProductModel(BaseModel):
    id: int
    price: float


class ChildModel(BaseModel):
    value: str


class ParentModel(BaseModel):
    child: ChildModel


class StatusEnum(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class PriorityEnum(StrEnum):
    HIGH = "high"
    LOW = "low"


class QueryModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page: int = Field(default=1, ge=1, le=100, description="Page number")
    keyword: str | None = Field(default=None, min_length=1, max_length=50, description="Search keyword")
    status: Literal["active", "inactive"] | None = Field(default=None, description="Status filter")
    app_id: str = Field(..., alias="appId", description="Application ID")
    tag_ids: list[str] = Field(default_factory=list, min_length=1, max_length=3, description="Tag IDs")
    ambiguous: int | str | None = Field(default=None, description="Ambiguous query parameter")


@pytest.fixture(autouse=True)
def mock_console_ns():
    """Mock the console_ns to avoid circular imports during test collection."""
    mock_ns = MagicMock(spec=Namespace)
    mock_ns.models = {}

    # Inject mock before importing schema module
    with patch.dict(sys.modules, {"controllers.console": MagicMock(console_ns=mock_ns)}):
        yield mock_ns


def test_default_ref_template_value():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_SWAGGER_2_0

    assert DEFAULT_REF_TEMPLATE_SWAGGER_2_0 == "#/definitions/{model}"


def test_register_schema_model_calls_namespace_schema_model():
    from controllers.common.schema import register_schema_model

    namespace = MagicMock(spec=Namespace)

    register_schema_model(namespace, UserModel)

    namespace.schema_model.assert_called_once()

    model_name, schema = namespace.schema_model.call_args.args

    assert model_name == "UserModel"
    assert isinstance(schema, dict)
    assert "properties" in schema


def test_register_schema_model_passes_schema_from_pydantic():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_SWAGGER_2_0, register_schema_model

    namespace = MagicMock(spec=Namespace)

    register_schema_model(namespace, UserModel)

    schema = namespace.schema_model.call_args.args[1]

    expected_schema = UserModel.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)

    assert schema == expected_schema


def test_register_schema_model_promotes_nested_pydantic_definitions():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_SWAGGER_2_0, register_schema_model

    namespace = MagicMock(spec=Namespace)

    register_schema_model(namespace, ParentModel)

    called_schemas = {call.args[0]: call.args[1] for call in namespace.schema_model.call_args_list}
    parent_schema = ParentModel.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)

    assert set(called_schemas) == {"ParentModel", "ChildModel"}
    assert "$defs" not in called_schemas["ParentModel"]
    assert called_schemas["ParentModel"]["properties"]["child"]["$ref"] == "#/definitions/ChildModel"
    assert called_schemas["ChildModel"] == parent_schema["$defs"]["ChildModel"]


def test_register_schema_models_registers_multiple_models():
    from controllers.common.schema import register_schema_models

    namespace = MagicMock(spec=Namespace)

    register_schema_models(namespace, UserModel, ProductModel)

    assert namespace.schema_model.call_count == 2

    called_names = [call.args[0] for call in namespace.schema_model.call_args_list]
    assert called_names == ["UserModel", "ProductModel"]


def test_register_schema_models_calls_register_schema_model(monkeypatch: pytest.MonkeyPatch):
    from controllers.common.schema import register_schema_models

    namespace = MagicMock(spec=Namespace)

    calls = []

    def fake_register(ns, model):
        calls.append((ns, model))

    monkeypatch.setattr(
        "controllers.common.schema.register_schema_model",
        fake_register,
    )

    register_schema_models(namespace, UserModel, ProductModel)

    assert calls == [
        (namespace, UserModel),
        (namespace, ProductModel),
    ]


def test_get_or_create_model_returns_existing_model(mock_console_ns):
    from controllers.common.schema import get_or_create_model

    existing_model = MagicMock()
    mock_console_ns.models = {"TestModel": existing_model}

    result = get_or_create_model("TestModel", {"key": "value"})

    assert result == existing_model
    mock_console_ns.model.assert_not_called()


def test_get_or_create_model_creates_new_model_when_not_exists(mock_console_ns):
    from controllers.common.schema import get_or_create_model

    mock_console_ns.models = {}
    new_model = MagicMock()
    mock_console_ns.model.return_value = new_model
    field_def = {"name": {"type": "string"}}

    result = get_or_create_model("NewModel", field_def)

    assert result == new_model
    mock_console_ns.model.assert_called_once_with("NewModel", field_def)


def test_get_or_create_model_does_not_call_model_if_exists(mock_console_ns):
    from controllers.common.schema import get_or_create_model

    existing_model = MagicMock()
    mock_console_ns.models = {"ExistingModel": existing_model}

    result = get_or_create_model("ExistingModel", {"key": "value"})

    assert result == existing_model
    mock_console_ns.model.assert_not_called()


def test_register_enum_models_registers_single_enum():
    from controllers.common.schema import register_enum_models

    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum)

    namespace.schema_model.assert_called_once()

    model_name, schema = namespace.schema_model.call_args.args

    assert model_name == "StatusEnum"
    assert isinstance(schema, dict)


def test_register_enum_models_registers_multiple_enums():
    from controllers.common.schema import register_enum_models

    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum, PriorityEnum)

    assert namespace.schema_model.call_count == 2

    called_names = [call.args[0] for call in namespace.schema_model.call_args_list]
    assert called_names == ["StatusEnum", "PriorityEnum"]


def test_register_enum_models_uses_correct_ref_template():
    from controllers.common.schema import register_enum_models

    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum)

    schema = namespace.schema_model.call_args.args[1]

    # Verify the schema contains enum values
    assert "enum" in schema or "anyOf" in schema


def test_query_params_from_model_builds_flask_restx_doc_params():
    from controllers.common.schema import query_params_from_model

    params = query_params_from_model(QueryModel)

    assert params["page"] == {
        "in": "query",
        "required": False,
        "description": "Page number",
        "type": "integer",
        "default": 1,
        "minimum": 1,
        "maximum": 100,
    }
    assert params["keyword"] == {
        "in": "query",
        "required": False,
        "description": "Search keyword",
        "type": "string",
        "minLength": 1,
        "maxLength": 50,
    }
    assert params["status"] == {
        "in": "query",
        "required": False,
        "description": "Status filter",
        "type": "string",
        "enum": ["active", "inactive"],
    }
    assert params["appId"] == {
        "in": "query",
        "required": True,
        "description": "Application ID",
        "type": "string",
    }
    assert params["tag_ids"] == {
        "in": "query",
        "required": False,
        "description": "Tag IDs",
        "type": "array",
        "items": {"type": "string"},
        "minItems": 1,
        "maxItems": 3,
    }
    assert params["ambiguous"] == {
        "in": "query",
        "required": False,
        "description": "Ambiguous query parameter",
    }
