import importlib.util
import json as _schema_json
import re
import sys
from collections.abc import Iterator
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Annotated, Literal, cast
from unittest.mock import patch

import pytest
from flask import Blueprint, Flask, Response, request_finished
from flask import json as _error_response_contract_check_json
from flask_restx import Namespace, Resource, fields
from jsonschema import Draft202012Validator, ValidationError
from pydantic import BaseModel, ConfigDict, Field, create_model

from controllers.common.schema import register_response_schema_models
from libs.exception import BaseHTTPException, RelayedHTTPError
from libs.external_api import ExternalApi, error_responses
from tests.helpers.unit.controllers import error_contract
from tests.helpers.unit.controllers.error_contract import check_response, violation


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
    tag_ids: list[Annotated[str, Field(min_length=1, max_length=255)]] = Field(
        default_factory=list,
        min_length=1,
        max_length=3,
        description="Tag IDs",
    )
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


def _make_same_named_model() -> type[BaseModel]:
    """Build a model whose qualified name differs from UserModel but whose bare name matches."""

    return create_model("UserModel", __module__="other_module", email=(str, ...))


class TestSchemaCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def console_ns():
        """Isolate the console import while exercising a real namespace."""
        namespace = Namespace("console")
        with patch.dict(sys.modules, {"controllers.console": SimpleNamespace(console_ns=namespace)}):
            yield namespace

    @staticmethod
    def test_default_ref_template_value():
        from controllers.common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0

        assert DEFAULT_REF_TEMPLATE_OPENAPI_3_0 == "#/components/schemas/{model}"

    @staticmethod
    def test_register_schema_model_calls_namespace_schema_model():
        from controllers.common.schema import register_schema_model

        namespace = Namespace("test")

        register_schema_model(namespace, UserModel)

        assert list(namespace.models) == ["UserModel"]
        schema = namespace.models["UserModel"].__schema__
        assert isinstance(schema, dict)
        assert "properties" in schema

    @staticmethod
    def test_register_schema_model_passes_schema_from_pydantic():
        from controllers.common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0, register_schema_model

        namespace = Namespace("test")

        register_schema_model(namespace, UserModel)

        schema = namespace.models["UserModel"].__schema__

        expected_schema = UserModel.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0)

        assert schema == expected_schema

    @staticmethod
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

    @staticmethod
    def test_register_schema_model_allows_reregistering_the_same_model():
        from controllers.common.schema import register_schema_model

        namespace = Namespace("test")

        register_schema_model(namespace, UserModel)
        register_schema_model(namespace, UserModel)

        assert list(namespace.models) == ["UserModel"]

    @staticmethod
    def test_register_schema_model_rejects_different_model_with_same_name():
        from controllers.common.schema import SchemaNameCollisionError, register_schema_model

        namespace = Namespace("test")
        register_schema_model(namespace, UserModel)

        with pytest.raises(SchemaNameCollisionError, match="'UserModel'.*produced by both"):
            register_schema_model(namespace, _make_same_named_model())

    @staticmethod
    def test_register_schema_model_rejects_nested_definition_with_same_name():
        from controllers.common.schema import SchemaNameCollisionError, register_schema_model

        other_child = create_model("ChildModel", __module__="other_module", other=(int, ...))
        other_parent = create_model("OtherParentModel", child=(other_child, ...))
        namespace = Namespace("test")
        register_schema_model(namespace, ParentModel)

        with pytest.raises(SchemaNameCollisionError, match="'ChildModel'"):
            register_schema_model(namespace, other_parent)

    @staticmethod
    def test_register_schema_model_rejects_same_named_types_inside_one_schema():
        from controllers.common.schema import SchemaNameCollisionError, register_schema_model

        other_child = create_model("ChildModel", __module__="other_module", other=(int, ...))
        both_children = create_model("BothChildrenModel", first=(ChildModel, ...), second=(other_child, ...))

        with pytest.raises(SchemaNameCollisionError, match="'ChildModel'"):
            register_schema_model(Namespace("test"), both_children)

    @staticmethod
    def test_register_schema_model_rejects_model_registered_in_both_modes_with_different_shapes():
        from controllers.common.schema import (
            SchemaNameCollisionError,
            register_response_schema_model,
            register_schema_model,
        )

        namespace = Namespace("test")
        register_response_schema_model(namespace, ResponseAliasModel)

        with pytest.raises(SchemaNameCollisionError, match="two different shapes"):
            register_schema_model(namespace, ResponseAliasModel)

    @staticmethod
    def test_register_schema_model_rejects_names_that_collide_after_normalization():
        from controllers.common.schema import SchemaNameCollisionError, register_schema_model

        namespace = Namespace("test")
        register_schema_model(namespace, create_model("JSONPayload", value=(str, ...)))

        with pytest.raises(SchemaNameCollisionError, match="once normalized"):
            register_schema_model(namespace, create_model("JsonPayload", value=(str, ...)))

    @staticmethod
    def test_register_schema_model_keeps_namespaces_independent():
        from controllers.common.schema import register_schema_model

        register_schema_model(Namespace("first"), UserModel)
        register_schema_model(Namespace("second"), _make_same_named_model())

    @staticmethod
    def test_register_schema_model_applies_schema_name_overrides(monkeypatch: pytest.MonkeyPatch):
        from controllers.common import schema as schema_module

        monkeypatch.setattr(
            schema_module,
            "SCHEMA_NAME_OVERRIDES",
            {f"{ChildModel.__module__}.{ChildModel.__qualname__}": "RenamedChildModel"},
        )
        namespace = Namespace("test")

        schema_module.register_schema_model(namespace, ParentModel)

        assert set(namespace.models) == {"ParentModel", "RenamedChildModel"}
        parent_schema = namespace.models["ParentModel"].__schema__
        assert parent_schema["properties"]["child"]["$ref"] == "#/components/schemas/RenamedChildModel"

    @staticmethod
    def test_register_schema_models_registers_multiple_models():
        from controllers.common.schema import register_schema_models

        namespace = Namespace("test")

        register_schema_models(namespace, UserModel, ProductModel)

        called_names = list(namespace.models)
        assert called_names == ["UserModel", "ProductModel"]

    @staticmethod
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

    @staticmethod
    def test_register_response_schema_model_uses_serialized_field_names():
        from controllers.common.schema import register_response_schema_model

        namespace = Namespace("test")

        register_response_schema_model(namespace, ResponseAliasModel)

        assert list(namespace.models) == ["ResponseAliasModel"]
        schema = namespace.models["ResponseAliasModel"].__schema__
        assert "public_name" in schema["properties"]
        assert "internal_name" not in schema["properties"]

    @staticmethod
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

    @staticmethod
    def test_get_or_create_model_returns_existing_model(console_ns):
        from controllers.common.schema import get_or_create_model

        existing_model = console_ns.model("TestModel", {"name": fields.String})

        result = get_or_create_model("TestModel", {"key": "value"})

        assert result is existing_model
        assert len(console_ns.models) == 1

    @staticmethod
    def test_get_or_create_model_creates_new_model_when_not_exists(console_ns):
        from controllers.common.schema import get_or_create_model

        field_def = {"name": fields.String}

        result = get_or_create_model("NewModel", field_def)

        assert result is console_ns.models["NewModel"]
        assert result.__schema__["properties"] == {"name": {"type": "string"}}

    @staticmethod
    def test_get_or_create_model_does_not_call_model_if_exists(console_ns):
        from controllers.common.schema import get_or_create_model

        existing_model = console_ns.model("ExistingModel", {"name": fields.String})

        result = get_or_create_model("ExistingModel", {"key": "value"})

        assert result is existing_model
        assert len(console_ns.models) == 1

    @staticmethod
    def test_register_enum_models_registers_single_enum():
        from controllers.common.schema import register_enum_models

        namespace = Namespace("test")

        register_enum_models(namespace, StatusEnum)

        assert list(namespace.models) == ["StatusEnum"]
        schema = namespace.models["StatusEnum"].__schema__
        assert isinstance(schema, dict)

    @staticmethod
    def test_register_enum_models_registers_multiple_enums():
        from controllers.common.schema import register_enum_models

        namespace = Namespace("test")

        register_enum_models(namespace, StatusEnum, PriorityEnum)

        called_names = list(namespace.models)
        assert called_names == ["StatusEnum", "PriorityEnum"]

    @staticmethod
    def test_register_enum_models_uses_correct_ref_template():
        from controllers.common.schema import register_enum_models

        namespace = Namespace("test")

        register_enum_models(namespace, StatusEnum)

        schema = namespace.models["StatusEnum"].__schema__

        # Verify the schema contains enum values
        assert "enum" in schema or "anyOf" in schema

    @staticmethod
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
            "items": {"type": "string", "minLength": 1, "maxLength": 255},
            "minItems": 1,
            "maxItems": 3,
        }
        assert params["ambiguous"] == {
            "in": "query",
            "required": False,
            "description": "Ambiguous query parameter",
        }

    @staticmethod
    def test_query_params_from_request_preserves_repeated_list_params():
        from controllers.common.schema import query_params_from_request

        app = Flask(__name__)
        with app.test_request_context("/?page=2&limit=30&status=active&status=inactive&keyword=hello"):
            query = query_params_from_request(HelperQueryModel, list_fields=("status",))

        assert query.page == 2
        assert query.limit == 30
        assert query.status == ["active", "inactive"]
        assert query.keyword == "hello"

    @staticmethod
    def test_query_params_from_request_raises_for_malformed_ints_by_default():
        from controllers.common.schema import query_params_from_request

        app = Flask(__name__)
        with app.test_request_context("/?page=bad&limit="):
            with pytest.raises(ValueError, match="2 validation errors for HelperQueryModel\\\npage"):
                query_params_from_request(HelperQueryModel, list_fields=("status",))

    @staticmethod
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


"""Coverage regressions for the enterprise inner API OpenAPI document."""


type Json = dict[str, object]

HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}
WRITE_METHODS = {"patch", "post", "put"}
ENTERPRISE_PREFIX = "/enterprise/"

EXPECTED_ENTERPRISE_OPERATION_IDS = {
    "create_enterprise_workspace",
    "create_enterprise_workspace_ownerless",
    "delete_enterprise_workspace_resources",
    "enterprise_app_detail",
    "enterprise_app_dsl_export",
    "enterprise_app_dsl_import",
    "enterprise_app_list",
    "enterprise_mint_file_grant",
    "enterprise_runtime_credentials_resolve",
    "join_enterprise_workspace_member",
    "send_enterprise_mail",
}


def _obj(value: object) -> Json:
    return cast(Json, value)


def _at(value: object, *keys: str) -> Json:
    """Walk nested JSON objects by key; each step is cast because the spec is untyped JSON."""
    node = _obj(value)
    for key in keys:
        node = _obj(node[key])
    return node


def _load_generate_swagger_specs_module() -> ModuleType:
    api_dir = Path(__file__).resolve().parents[4]
    script_path = api_dir / "dev" / "generate_swagger_specs.py"

    spec = importlib.util.spec_from_file_location("generate_swagger_specs", script_path)
    assert spec
    assert spec.loader

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def _enterprise_operations(spec: Json) -> Iterator[tuple[str, str, Json, Json]]:
    for path, path_item in _obj(spec["paths"]).items():
        if not path.startswith(ENTERPRISE_PREFIX):
            continue
        item = _obj(path_item)
        for method, operation in item.items():
            if method in HTTP_METHODS:
                yield path, method, item, _obj(operation)


def _operation(spec: Json, path: str, method: str) -> Json:
    return _at(spec, "paths", path, method)


def _schema(spec: Json, name: str) -> Json:
    return _at(spec, "components", "schemas", name)


def _refs(value: object) -> Iterator[str]:
    if isinstance(value, dict):
        mapping = _obj(value)
        ref = mapping.get("$ref")
        if isinstance(ref, str):
            yield ref
        for child in mapping.values():
            yield from _refs(child)
    elif isinstance(value, list):
        for child in cast(list[object], value):
            yield from _refs(child)


def _validator(spec: Json, name: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": f"#/components/schemas/{name}", "components": spec["components"]})


ERROR_RESPONSE_REF = {"$ref": "#/components/schemas/ErrorResponse"}
LEGACY_SIMPLE_MESSAGE_RESPONSES = {
    "create_enterprise_workspace": ("404",),
    "enterprise_app_dsl_import": ("404",),
    "enterprise_runtime_credentials_resolve": ("400", "404"),
    "join_enterprise_workspace_member": ("400", "404"),
}
FILE_GRANT_BUSINESS_COMPONENTS = {
    "400": {"InvalidRequestError", "GrantTtlTooLongError", "InvalidSubjectError"},
    "404": {"AppNotFoundError", "FileNotFoundError"},
}


def _response_schema(operation: Json, code: str) -> Json:
    return _at(operation, "responses", code, "content", "application/json", "schema")


def _alternatives(schema: Json) -> list[Json]:
    return [_obj(item) for item in cast(list[object], schema["anyOf"])] if "anyOf" in schema else [schema]


def _operations_by_id(spec: Json) -> dict[str, Json]:
    return {str(operation["operationId"]): operation for _, _, _, operation in _enterprise_operations(spec)}


class TestSchemaCasesInnerApi:
    @staticmethod
    @pytest.fixture(scope="module")
    def inner_spec(tmp_path_factory: pytest.TempPathFactory) -> Json:
        module = _load_generate_swagger_specs_module()
        written_paths = module.generate_specs(tmp_path_factory.mktemp("inner_api_spec"))
        inner_path = next(path for path in written_paths if path.name == "inner-openapi.json")
        return _obj(_schema_json.loads(inner_path.read_text(encoding="utf-8")))

    @staticmethod
    def test_enterprise_operations_declare_typed_request_bodies(inner_spec: Json) -> None:
        operations = list(_enterprise_operations(inner_spec))
        assert operations

        for path, method, _, operation in operations:
            if method in WRITE_METHODS:
                media = _at(operation, "requestBody", "content", "application/json")
                assert "schema" in media, f"{method} {path} request body has no schema"
            if method == "get":
                assert "requestBody" not in operation, f"GET {path} must not declare a request body"

    @staticmethod
    def test_enterprise_success_responses_are_typed(inner_spec: Json) -> None:
        for path, method, _, operation in _enterprise_operations(inner_spec):
            for code, response in _obj(operation["responses"]).items():
                if not code.startswith("2"):
                    continue
                content = _obj(_obj(response).get("content"))
                assert content, f"{method} {path} {code} has no content"
                for media_type, media in content.items():
                    assert "schema" in _obj(media), f"{method} {path} {code} {media_type} has no schema"

    @staticmethod
    def test_enterprise_error_responses_are_typed(inner_spec: Json) -> None:
        for path, method, _, operation in _enterprise_operations(inner_spec):
            for code, response in _obj(operation["responses"]).items():
                if code.startswith("2"):
                    continue
                content = _obj(_obj(response).get("content"))
                assert content, f"{method} {path} {code} is not typed"
                json_media = _obj(content.get("application/json"))
                assert "schema" in json_media, f"{method} {path} {code} has no JSON schema"

    @staticmethod
    def test_enterprise_path_placeholders_have_required_path_parameters(inner_spec: Json) -> None:
        for path, method, path_item, operation in _enterprise_operations(inner_spec):
            parameters = [
                *cast(list[Json], path_item.get("parameters", [])),
                *cast(list[Json], operation.get("parameters", [])),
            ]
            declared = {
                parameter["name"]
                for parameter in parameters
                if parameter.get("in") == "path" and parameter.get("required") is True
            }
            for placeholder in re.findall(r"{(\w+)}", path):
                assert placeholder in declared, f"{method} {path} missing required path parameter {placeholder}"

    @staticmethod
    def test_enterprise_schema_references_resolve(inner_spec: Json) -> None:
        schemas = _at(inner_spec, "components", "schemas")
        for _, _, _, operation in _enterprise_operations(inner_spec):
            for ref in _refs(operation):
                assert ref.removeprefix("#/components/schemas/") in schemas, ref

    @staticmethod
    def test_enterprise_operation_ids_are_unchanged(inner_spec: Json) -> None:
        operation_ids = [operation["operationId"] for _, _, _, operation in _enterprise_operations(inner_spec)]

        assert len(operation_ids) == len(set(operation_ids))
        assert set(operation_ids) == EXPECTED_ENTERPRISE_OPERATION_IDS

    @staticmethod
    def test_enterprise_mail_documents_simple_message_response(inner_spec: Json) -> None:
        media = _at(
            _operation(inner_spec, "/enterprise/mail", "post"), "responses", "200", "content", "application/json"
        )

        assert media["schema"] == {"$ref": "#/components/schemas/SimpleMessageResponse"}

    @staticmethod
    def test_ownerless_workspace_custom_config_is_object(inner_spec: Json) -> None:
        schema = _schema(inner_spec, "WorkspaceOwnerlessTenantResponse")
        custom_config = _at(schema, "properties", "custom_config")

        assert custom_config["type"] == "object"
        assert custom_config["additionalProperties"] is True
        assert "custom_config" in cast(list[str], schema["required"])

    @staticmethod
    def test_owner_workspace_variant_excludes_custom_config_and_public_key(inner_spec: Json) -> None:
        owner = _obj(_schema(inner_spec, "WorkspaceResponse")["properties"])

        assert {"custom_config", "encrypt_public_key"}.isdisjoint(owner)

    @staticmethod
    def test_runtime_credential_values_accept_arbitrary_fields(inner_spec: Json) -> None:
        values = _at(_schema(inner_spec, "InnerRuntimeCredentialResponse"), "properties", "values")

        assert values["type"] == "object"
        assert values["additionalProperties"] is True

    @staticmethod
    def test_import_response_excludes_app_created(inner_spec: Json) -> None:
        assert "app_created" not in _obj(_schema(inner_spec, "Import")["properties"])

    @staticmethod
    def test_dsl_export_documents_yaml_data_string(inner_spec: Json) -> None:
        assert _at(_schema(inner_spec, "AppExportResponse"), "properties", "data")["type"] == "string"

    @staticmethod
    def test_ownerless_create_sample_validates_custom_config_object(inner_spec: Json) -> None:
        tenant = {
            "id": "t",
            "name": "n",
            "plan": "p",
            "status": "normal",
            "encrypt_public_key": None,
            "custom_config": {"remove_webapp_brand": True},
            "created_at": None,
            "updated_at": None,
        }
        validator = _validator(inner_spec, "WorkspaceOwnerlessCreateResponse")

        validator.validate({"message": "ok", "tenant": tenant})
        validator.validate({"message": "ok", "tenant": {**tenant, "custom_config": {}}})
        with pytest.raises(ValidationError):
            validator.validate({"message": "ok", "tenant": {**tenant, "custom_config": _schema_json.dumps({"a": 1})}})

    @staticmethod
    def test_credentials_sample_accepts_arbitrary_values(inner_spec: Json) -> None:
        _validator(inner_spec, "InnerRuntimeCredentialsResolveResponse").validate(
            {
                "credentials": [
                    {"credential_id": "c", "provider": "p", "kind": "model", "values": {"api_key": "k", "x": 1}}
                ]
            }
        )

    @staticmethod
    def test_enterprise_operations_document_default_error_response(inner_spec: Json) -> None:
        for path, method, _, operation in _enterprise_operations(inner_spec):
            assert _response_schema(operation, "default") == ERROR_RESPONSE_REF, f"{method} {path}"

    @staticmethod
    def test_enterprise_documented_errors_include_standard_error_body(inner_spec: Json) -> None:
        for path, method, _, operation in _enterprise_operations(inner_spec):
            for code in _obj(operation["responses"]):
                if code == "default" or not code.startswith(("4", "5")):
                    continue
                assert ERROR_RESPONSE_REF in _alternatives(_response_schema(operation, code)), f"{method} {path} {code}"

    @staticmethod
    def test_legacy_message_statuses_document_simple_message(inner_spec: Json) -> None:
        operations = _operations_by_id(inner_spec)
        for operation_id, codes in LEGACY_SIMPLE_MESSAGE_RESPONSES.items():
            for code in codes:
                assert {"$ref": "#/components/schemas/SimpleMessageResponse"} in _alternatives(
                    _response_schema(operations[operation_id], code)
                ), f"{operation_id} {code}"

    @staticmethod
    def test_dsl_export_not_found_union_documents_simple_message(inner_spec: Json) -> None:
        operation = _operations_by_id(inner_spec)["enterprise_app_dsl_export"]
        assert _alternatives(_response_schema(operation, "404"))[0] == {
            "$ref": "#/components/schemas/EnterpriseAppDSLExportNotFoundResponse"
        }
        union = _alternatives(_schema(inner_spec, "EnterpriseAppDSLExportNotFoundResponse"))
        assert {"$ref": "#/components/schemas/SimpleMessageResponse"} in union

    @staticmethod
    def test_file_grants_document_business_error_components(inner_spec: Json) -> None:
        operation = _operations_by_id(inner_spec)["enterprise_mint_file_grant"]
        for code, expected in FILE_GRANT_BUSINESS_COMPONENTS.items():
            refs = {
                str(item["$ref"]).rsplit("/", 1)[-1]
                for item in _alternatives(_response_schema(operation, code))
                if "$ref" in item
            }
            assert expected <= refs, (code, refs)
            for name in expected:
                error_body = cast(list[object], _schema(inner_spec, name)["allOf"])[1]
                assert _at(error_body, "properties", "status")["const"] == int(code), name


class _ItemGoneError(BaseHTTPException):
    error_code = "item_gone"
    code = 404


class _ItemLockedDetails(BaseModel):
    locked_by: str


class _ItemLockedError(BaseHTTPException):
    error_code = "item_locked"
    code = 404
    details_model = _ItemLockedDetails


class _LegacyConflict(BaseModel):
    error: str


def _api() -> tuple[Flask, ExternalApi]:
    app = Flask(__name__)
    blueprint = Blueprint("contract_check", __name__, url_prefix="/check")
    api = ExternalApi(blueprint)
    ns = Namespace("items", path="/")
    register_response_schema_models(ns, _LegacyConflict)

    @ns.route("/items")
    class Items(Resource):
        @ns.response(409, "Legacy conflict", ns.models[_LegacyConflict.__name__])
        @error_responses(_ItemGoneError, _ItemLockedError)
        def get(self) -> dict[str, str]:
            return {}

    @ns.route("/relayed")
    class Relayed(Resource):
        @error_responses(_ItemGoneError, RelayedHTTPError)
        def get(self) -> dict[str, str]:
            return {}

    api.add_namespace(ns)
    app.register_blueprint(blueprint)
    return app, api


def _check(body: object, status: int, path: str = "/check/items") -> str | None:
    app, api = _api()
    with app.test_request_context(path):
        return violation(
            api, Response(_error_response_contract_check_json.dumps(body), status=status, mimetype="application/json")
        )


class TestErrorResponseContractCheckCases:
    @staticmethod
    def test_rejects_a_body_without_the_standard_fields() -> None:
        found = _check({"error": "gone"}, 404)
        assert found is not None
        assert "lacks" in found

    @staticmethod
    def test_rejects_a_code_the_operation_does_not_document_for_the_status() -> None:
        found = _check({"code": "surprise", "message": "m", "status": 404}, 404)
        assert found is not None
        assert "'surprise' is not documented" in found

    @staticmethod
    def test_accepts_documented_and_implied_codes() -> None:
        assert _check({"code": "item_gone", "message": "m", "status": 404}, 404) is None
        assert _check({"code": "not_found", "message": "m", "status": 404}, 404) is None

    @staticmethod
    def test_generic_codes_satisfy_the_full_schema_of_a_status_that_documents_business_errors() -> None:
        # A generic 404 answers an operation that documents its own 404 codes: the status's complete
        # schema (not only ``default``) must admit it, so the open error body stays in the ``anyOf``.
        app, api = _api()
        with app.test_request_context("/check/items"):
            schema = error_contract._document(api)["paths"]["/items"]["get"]["responses"]["404"]["content"][  # type: ignore[index]
                "application/json"
            ]["schema"]
        assert schema["anyOf"][-1] == {"$ref": "#/components/schemas/ErrorResponse"}
        assert _check({"code": "not_found", "message": "m", "status": 404}, 404) is None

    @staticmethod
    def test_validates_a_documented_code_against_its_component() -> None:
        assert (
            _check({"code": "item_locked", "message": "m", "status": 404, "details": {"locked_by": "a"}}, 404) is None
        )

        found = _check({"code": "item_locked", "message": "m", "status": 404, "details": {}}, 404)
        assert found is not None
        assert "'item_locked' component" in found
        assert "locked_by" in found

    @staticmethod
    def test_accepts_a_body_matching_a_legacy_model_the_status_declares() -> None:
        assert _check({"error": "legacy"}, 409) is None
        assert _check({"code": "conflict", "message": "m", "status": 409}, 409) is None

    @staticmethod
    def test_rejects_a_documented_code_served_with_another_status(monkeypatch: pytest.MonkeyPatch) -> None:
        # On the surfaces the lint covers every served code must be documented or generic.
        monkeypatch.setattr(error_contract, "_documents_business_errors", lambda _api: True)
        found = _check({"code": "item_gone", "message": "m", "status": 409}, 409)
        assert found is not None
        assert "'item_gone' is not documented" in found

    @staticmethod
    def test_accepts_any_code_from_an_operation_that_relays_errors(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(error_contract, "_documents_business_errors", lambda _api: True)
        assert _check({"code": "downstream_busy", "message": "m", "status": 503}, 503, "/check/relayed") is None
        assert _check({"code": "item_gone", "message": "m", "status": 404}, 404, "/check/relayed") is None
        # Relaying never excuses a body that is not the error body.
        found = _check({"error": "x"}, 503, "/check/relayed")
        assert found is not None
        assert "lacks" in found

    @staticmethod
    def test_only_checks_documented_statuses_on_apis_without_business_errors() -> None:
        # A test-built API (like /openapi/v1) documents nothing, so an undocumented status stays open.
        assert _check({"code": "item_gone", "message": "m", "status": 409}, 409) is None

    @staticmethod
    def test_rejects_a_body_matching_neither_the_legacy_nor_the_standard_model() -> None:
        found = _check({"code": "conflict", "message": "m"}, 409)
        assert found is not None
        assert "lacks ['status']" in found

    @staticmethod
    @pytest.mark.parametrize(
        ("body", "field"),
        [
            ({"code": "item_gone", "message": {"nested": True}, "status": 404}, "message"),
            ({"code": ["item_gone"], "message": "m", "status": 404}, "code"),
            ({"code": "item_gone", "message": "m", "status": "404"}, "status"),
        ],
    )
    def test_rejects_standard_fields_of_the_wrong_type(body: dict[str, object], field: str) -> None:
        found = _check(body, 404)
        assert found is not None
        assert "does not match ErrorResponse" in found
        assert f"{field}:" in found

    @staticmethod
    @pytest.mark.allow_error_contract_violations
    def test_checks_responses_served_by_an_api_mounted_on_the_app() -> None:
        app = Flask(__name__)
        api = ExternalApi(app)

        @api.route("/items")
        class Items(Resource):
            def get(self) -> tuple[dict[str, str], int]:
                return {"wrong": "shape"}, 400

        violations: list[str] = []

        def receiver(sender: Flask, response: Response, **_: object) -> None:
            check_response(sender, response, violations)

        with request_finished.connected_to(receiver, app):
            app.test_client().get("/items")

        assert len(violations) == 1
        assert "lacks" in violations[0]

    @staticmethod
    @pytest.mark.allow_error_contract_violations
    def test_reports_responses_it_cannot_check() -> None:
        app = Flask(__name__)
        api = ExternalApi(app)

        class _Unregistered(BaseModel):
            value: str

        @api.route("/items")
        class Items(Resource):
            @api.response(200, "OK", _Unregistered.__name__)
            def get(self) -> tuple[dict[str, str], int]:
                return {"wrong": "shape"}, 400

        violations: list[str] = []

        def receiver(sender: Flask, response: Response, **_: object) -> None:
            check_response(sender, response, violations)

        with request_finished.connected_to(receiver, app):
            app.test_client().get("/items")

        assert len(violations) == 1
        assert "cannot check the error contract" in violations[0]
