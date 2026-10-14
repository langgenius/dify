"""Coverage regressions for the enterprise inner API OpenAPI document."""

import importlib.util
import json
import re
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest
from jsonschema import Draft202012Validator, ValidationError

type Json = dict[str, object]

HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}
WRITE_METHODS = {"patch", "post", "put"}
ENTERPRISE_PREFIX = "/enterprise/"

EXPECTED_ENTERPRISE_OPERATION_IDS = {
    "create_enterprise_workspace",
    "create_enterprise_workspace_ownerless",
    "delete_enterprise_workspace_resources",
    "enterprise_app_dsl_export",
    "enterprise_app_dsl_import",
    "enterprise_mint_file_grant",
    "enterprise_runtime_credentials_resolve",
    "join_enterprise_workspace_member",
    "send_enterprise_mail",
}


def _obj(value: object) -> Json:
    return cast(Json, value)


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


@pytest.fixture(scope="module")
def inner_spec(tmp_path_factory: pytest.TempPathFactory) -> Json:
    module = _load_generate_swagger_specs_module()
    written_paths = module.generate_specs(tmp_path_factory.mktemp("inner_api_spec"))
    inner_path = next(path for path in written_paths if path.name == "inner-openapi.json")
    return _obj(json.loads(inner_path.read_text(encoding="utf-8")))


def _enterprise_operations(spec: Json) -> Iterator[tuple[str, str, Json, Json]]:
    for path, path_item in _obj(spec["paths"]).items():
        if not path.startswith(ENTERPRISE_PREFIX):
            continue
        item = _obj(path_item)
        for method, operation in item.items():
            if method in HTTP_METHODS:
                yield path, method, item, _obj(operation)


def _operation(spec: Json, path: str, method: str) -> Json:
    return _obj(_obj(_obj(spec["paths"])[path])[method])


def _schema(spec: Json, name: str) -> Json:
    return _obj(_obj(_obj(spec["components"])["schemas"])[name])


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


def test_enterprise_operations_declare_typed_request_bodies(inner_spec: Json) -> None:
    operations = list(_enterprise_operations(inner_spec))
    assert operations

    for path, method, _, operation in operations:
        if method in WRITE_METHODS:
            media = _obj(_obj(_obj(operation["requestBody"])["content"])["application/json"])
            assert "schema" in media, f"{method} {path} request body has no schema"
        if method == "get":
            assert "requestBody" not in operation, f"GET {path} must not declare a request body"


def test_enterprise_success_responses_are_typed(inner_spec: Json) -> None:
    for path, method, _, operation in _enterprise_operations(inner_spec):
        for code, response in _obj(operation["responses"]).items():
            if not code.startswith("2"):
                continue
            content = _obj(_obj(response).get("content"))
            assert content, f"{method} {path} {code} has no content"
            for media_type, media in content.items():
                assert "schema" in _obj(media), f"{method} {path} {code} {media_type} has no schema"


def test_enterprise_error_responses_are_typed(inner_spec: Json) -> None:
    for path, method, _, operation in _enterprise_operations(inner_spec):
        for code, response in _obj(operation["responses"]).items():
            if code.startswith("2"):
                continue
            content = _obj(_obj(response).get("content"))
            assert content, f"{method} {path} {code} is not typed"
            json_media = _obj(content.get("application/json"))
            assert "schema" in json_media, f"{method} {path} {code} has no JSON schema"


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


def test_enterprise_schema_references_resolve(inner_spec: Json) -> None:
    schemas = _obj(_obj(inner_spec["components"])["schemas"])
    for _, _, _, operation in _enterprise_operations(inner_spec):
        for ref in _refs(operation):
            assert ref.removeprefix("#/components/schemas/") in schemas, ref


def test_enterprise_operation_ids_are_unchanged(inner_spec: Json) -> None:
    operation_ids = [operation["operationId"] for _, _, _, operation in _enterprise_operations(inner_spec)]

    assert len(operation_ids) == len(set(operation_ids))
    assert set(operation_ids) == EXPECTED_ENTERPRISE_OPERATION_IDS


def test_enterprise_mail_documents_simple_message_response(inner_spec: Json) -> None:
    media = _obj(_obj(_operation(inner_spec, "/enterprise/mail", "post")["responses"])["200"])

    assert _obj(_obj(media["content"])["application/json"])["schema"] == {
        "$ref": "#/components/schemas/SimpleMessageResponse"
    }


def test_ownerless_workspace_custom_config_is_object(inner_spec: Json) -> None:
    schema = _schema(inner_spec, "WorkspaceOwnerlessTenantResponse")
    custom_config = _obj(_obj(schema["properties"])["custom_config"])

    assert custom_config["type"] == "object"
    assert custom_config["additionalProperties"] is True
    assert "custom_config" in cast(list[str], schema["required"])


def test_owner_workspace_variant_excludes_custom_config_and_public_key(inner_spec: Json) -> None:
    owner = _obj(_schema(inner_spec, "WorkspaceResponse")["properties"])

    assert {"custom_config", "encrypt_public_key"}.isdisjoint(owner)


def test_runtime_credential_values_accept_arbitrary_fields(inner_spec: Json) -> None:
    values = _obj(_obj(_schema(inner_spec, "InnerRuntimeCredentialResponse")["properties"])["values"])

    assert values["type"] == "object"
    assert values["additionalProperties"] is True


def test_import_response_excludes_app_created(inner_spec: Json) -> None:
    assert "app_created" not in _obj(_schema(inner_spec, "Import")["properties"])


def test_dsl_export_documents_yaml_data_string(inner_spec: Json) -> None:
    assert _obj(_obj(_schema(inner_spec, "AppExportResponse")["properties"])["data"])["type"] == "string"


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
        validator.validate({"message": "ok", "tenant": {**tenant, "custom_config": json.dumps({"a": 1})}})


def test_credentials_sample_accepts_arbitrary_values(inner_spec: Json) -> None:
    _validator(inner_spec, "InnerRuntimeCredentialsResolveResponse").validate(
        {"credentials": [{"credential_id": "c", "provider": "p", "kind": "model", "values": {"api_key": "k", "x": 1}}]}
    )


def test_inner_error_response_allows_optional_central_fields(inner_spec: Json) -> None:
    validator = _validator(inner_spec, "InnerApiErrorResponse")

    validator.validate({"message": "legacy"})
    validator.validate({"message": "central", "code": "c", "status": 401})
