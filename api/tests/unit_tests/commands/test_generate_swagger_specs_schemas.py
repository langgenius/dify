"""generate swagger specs schemas tests."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator

from tests.unit_tests.commands._swagger_spec_helpers import (
    _get_operations,
    _load_generate_swagger_specs_module,
    _operation_ids,
    _walk_values,
)


def test_generate_specs_writes_openapi_with_resolvable_references_and_null_defaults(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        schemas = payload["components"]["schemas"]
        refs = {
            item["$ref"].removeprefix("#/components/schemas/")
            for item in _walk_values(payload)
            if isinstance(item, dict)
            and isinstance(item.get("$ref"), str)
            and item["$ref"].startswith("#/components/schemas/")
        }

        assert refs <= set(schemas)
        assert all("nullable" not in value for value in _walk_values(payload) if isinstance(value, dict))

    service_payload = json.loads((tmp_path / "service-openapi.json").read_text(encoding="utf-8"))
    conversation_id = service_payload["components"]["schemas"]["ChatRequestPayload"]["properties"]["conversation_id"]
    assert "default" in conversation_id
    assert conversation_id["default"] is None

    schemas = service_payload["components"]["schemas"]
    document_detail = schemas["DocumentDetailResponse"]
    validator = Draft202012Validator(service_payload)
    for schema in (document_detail, *schemas["DocumentTextUpdate"]["anyOf"]):
        for property_schema in schema["properties"].values():
            if "default" in property_schema:
                validator.evolve(schema=property_schema).validate(property_schema["default"])

    assert document_detail["required"] == ["id"]
    assert document_detail["properties"]["enabled"]["type"] == "boolean"
    assert "default" not in document_detail["properties"]["enabled"]
    assert document_detail["properties"]["tokens"]["default"] is None


def test_generate_specs_writes_unique_operation_ids(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        operation_ids = list(_operation_ids(payload))

        assert len(operation_ids) == len(set(operation_ids))


def test_generate_specs_writes_get_operations_without_request_bodies(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert all("requestBody" not in operation for operation in _get_operations(payload))
