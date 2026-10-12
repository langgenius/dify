import sys
from datetime import datetime
from enum import StrEnum
from types import SimpleNamespace
from typing import Literal
from unittest.mock import patch

import pytest
from flask import Flask
from flask_restx import Namespace, fields
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
    enum_status: StatusEnum | None = Field(default=None, description="Enum status filter")
    created_at: datetime | None = Field(default=None, description="Creation time")
    app_id: str = Field(..., alias="appId", description="Application ID")
    tag_ids: list[str] = Field(default_factory=list, min_length=1, max_length=3, description="Tag IDs")
    ambiguous: int | str | None = Field(default=None, description="Ambiguous query parameter")


class HelperQueryModel(BaseModel):
    page: int = 1
    limit: int = 20
    status: list[str] = Field(default_factory=list)
    keyword: str | None = None


class NullableSchemaModel(BaseModel):
    name: str | None = None
    tags: list[str] | None = None
    owner: UserModel | None = None
    ambiguous: int | str | None = None


class ResponseAliasModel(BaseModel):
    public_name: str = Field(validation_alias="internal_name")


@pytest.fixture(autouse=True)
def console_ns():
    """Isolate the console import while exercising a real namespace."""
    namespace = Namespace("console")
    with patch.dict(sys.modules, {"controllers.console": SimpleNamespace(console_ns=namespace)}):
        yield namespace


def test_default_ref_template_value():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0

    assert DEFAULT_REF_TEMPLATE_OPENAPI_3_0 == "#/components/schemas/{model}"


def test_register_schema_model_calls_namespace_schema_model():
    from controllers.common.schema import register_schema_model

    namespace = Namespace("test")

    register_schema_model(namespace, UserModel)

    assert list(namespace.models) == ["UserModel"]
    schema = namespace.models["UserModel"].__schema__
    assert isinstance(schema, dict)
    assert "properties" in schema


def test_register_schema_model_passes_schema_from_pydantic():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0, register_schema_model

    namespace = Namespace("test")

    register_schema_model(namespace, UserModel)

    schema = namespace.models["UserModel"].__schema__

    expected_schema = UserModel.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0)

    assert schema == expected_schema


def test_register_schema_model_promotes_nested_pydantic_definitions():
    from controllers.common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0, register_schema_model

    namespace = Namespace("test")

    register_schema_model(namespace, ParentModel)

    called_schemas = {name: model.__schema__ for name, model in namespace.models.items()}
    parent_schema = ParentModel.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0)

    assert set(called_schemas) == {"ParentModel", "ChildModel"}
    assert "$defs" not in called_schemas["ParentModel"]
    assert called_schemas["ParentModel"]["properties"]["child"]["$ref"] == "#/components/schemas/ChildModel"
    assert called_schemas["ChildModel"] == parent_schema["$defs"]["ChildModel"]


def test_register_schema_models_registers_multiple_models():
    from controllers.common.schema import register_schema_models

    namespace = Namespace("test")

    register_schema_models(namespace, UserModel, ProductModel)

    called_names = list(namespace.models)
    assert called_names == ["UserModel", "ProductModel"]


def test_register_schema_models_calls_register_schema_model(monkeypatch: pytest.MonkeyPatch):
    from controllers.common.schema import register_schema_models

    namespace = Namespace("test")

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


def test_register_response_schema_model_uses_serialized_field_names():
    from controllers.common.schema import register_response_schema_model

    namespace = Namespace("test")

    register_response_schema_model(namespace, ResponseAliasModel)

    assert list(namespace.models) == ["ResponseAliasModel"]
    schema = namespace.models["ResponseAliasModel"].__schema__
    assert "public_name" in schema["properties"]
    assert "internal_name" not in schema["properties"]


def test_register_schema_model_preserves_openapi_nullable_unions():
    from controllers.common.schema import register_schema_model

    namespace = Namespace("test")

    register_schema_model(namespace, NullableSchemaModel)

    called_schemas = {name: model.__schema__ for name, model in namespace.models.items()}
    properties = called_schemas["NullableSchemaModel"]["properties"]

    assert properties["name"]["anyOf"] == [{"type": "string"}, {"type": "null"}]
    assert properties["tags"]["anyOf"] == [{"items": {"type": "string"}, "type": "array"}, {"type": "null"}]
    assert properties["owner"]["anyOf"] == [{"$ref": "#/components/schemas/UserModel"}, {"type": "null"}]
    assert "anyOf" in properties["ambiguous"]


def test_get_or_create_model_returns_existing_model(console_ns):
    from controllers.common.schema import get_or_create_model

    existing_model = console_ns.model("TestModel", {"name": fields.String})

    result = get_or_create_model("TestModel", {"key": "value"})

    assert result is existing_model
    assert len(console_ns.models) == 1


def test_get_or_create_model_creates_new_model_when_not_exists(console_ns):
    from controllers.common.schema import get_or_create_model

    field_def = {"name": fields.String}

    result = get_or_create_model("NewModel", field_def)

    assert result is console_ns.models["NewModel"]
    assert result.__schema__["properties"] == {"name": {"type": "string"}}


def test_get_or_create_model_does_not_call_model_if_exists(console_ns):
    from controllers.common.schema import get_or_create_model

    existing_model = console_ns.model("ExistingModel", {"name": fields.String})

    result = get_or_create_model("ExistingModel", {"key": "value"})

    assert result is existing_model
    assert len(console_ns.models) == 1


def test_register_enum_models_registers_single_enum():
    from controllers.common.schema import register_enum_models

    namespace = Namespace("test")

    register_enum_models(namespace, StatusEnum)

    assert list(namespace.models) == ["StatusEnum"]
    schema = namespace.models["StatusEnum"].__schema__
    assert isinstance(schema, dict)


def test_register_enum_models_registers_multiple_enums():
    from controllers.common.schema import register_enum_models

    namespace = Namespace("test")

    register_enum_models(namespace, StatusEnum, PriorityEnum)

    called_names = list(namespace.models)
    assert called_names == ["StatusEnum", "PriorityEnum"]


def test_register_enum_models_uses_correct_ref_template():
    from controllers.common.schema import register_enum_models

    namespace = Namespace("test")

    register_enum_models(namespace, StatusEnum)

    schema = namespace.models["StatusEnum"].__schema__

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
    assert params["enum_status"] == {
        "in": "query",
        "required": False,
        "description": "Enum status filter",
        "type": "string",
        "enum": ["active", "inactive"],
    }
    assert params["created_at"] == {
        "in": "query",
        "required": False,
        "description": "Creation time",
        "type": "string",
        "format": "date-time",
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


def test_query_params_from_request_preserves_repeated_list_params():
    from controllers.common.schema import query_params_from_request

    app = Flask(__name__)
    with app.test_request_context("/?page=2&limit=30&status=active&status=inactive&keyword=hello"):
        query = query_params_from_request(HelperQueryModel, list_fields=("status",))

    assert query.page == 2
    assert query.limit == 30
    assert query.status == ["active", "inactive"]
    assert query.keyword == "hello"


def test_query_params_from_request_raises_for_malformed_ints_by_default():
    from controllers.common.schema import query_params_from_request

    app = Flask(__name__)
    with app.test_request_context("/?page=bad&limit="):
        with pytest.raises(ValueError):
            query_params_from_request(HelperQueryModel, list_fields=("status",))


def test_query_params_from_request_can_use_model_default_for_malformed_defaulted_ints():
    from controllers.common.schema import query_params_from_request

    app = Flask(__name__)
    with app.test_request_context("/?page=bad&limit="):
        query = query_params_from_request(
            HelperQueryModel,
            list_fields=("status",),
            use_defaults_for_malformed_ints=True,
        )

    assert query.page == 1
    assert query.limit == 20
    assert query.status == []
