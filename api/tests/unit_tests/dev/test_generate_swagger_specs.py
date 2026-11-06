"""Unit tests for the standalone OpenAPI export helper."""

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from tests.helpers.unit.config_override import apply_config_overrides


def _walk_values(value):
    yield value
    match value:
        case dict():
            for child in value.values():
                yield from _walk_values(child)
        case list():
            for child in value:
                yield from _walk_values(child)


def _load_generate_swagger_specs_module():
    api_dir = Path(__file__).resolve().parents[3]
    script_path = api_dir / "dev" / "generate_swagger_specs.py"

    spec = importlib.util.spec_from_file_location("generate_swagger_specs", script_path)
    assert spec
    assert spec.loader

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def _operation_ids(payload):
    methods = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}
    for path_item in payload["paths"].values():
        for method, operation in path_item.items():
            if method in methods and isinstance(operation, dict) and "operationId" in operation:
                yield operation["operationId"]


def _get_operations(payload):
    for path_item in payload["paths"].values():
        operation = path_item.get("get")
        if isinstance(operation, dict):
            yield operation


def _response_schema(operation, status="200"):
    return operation["responses"][status]["content"]["application/json"]["schema"]


def _request_schema(operation, content_type="application/json"):
    return operation["requestBody"]["content"][content_type]["schema"]


def _reset_schema_cache(api):
    api._schema = None
    api.__dict__.pop("__schema__", None)


_OPENAPI_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}

_SCHEMA_MAP_KEYWORDS = ("$defs", "definitions", "dependentSchemas", "patternProperties", "properties")
_SCHEMA_OBJECT_KEYWORDS = (
    "additionalProperties",
    "contains",
    "else",
    "if",
    "items",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties",
)
_SCHEMA_LIST_KEYWORDS = ("allOf", "anyOf", "oneOf", "prefixItems")


def _iter_subschemas(schema):
    if not isinstance(schema, dict):
        return
    yield schema
    for keyword in _SCHEMA_MAP_KEYWORDS:
        for child in (schema.get(keyword) or {}).values():
            yield from _iter_subschemas(child)
    for keyword in _SCHEMA_OBJECT_KEYWORDS:
        if keyword in schema:
            child = schema[keyword]
            if isinstance(child, list):
                for item in child:
                    yield from _iter_subschemas(item)
            else:
                yield from _iter_subschemas(child)
    for keyword in _SCHEMA_LIST_KEYWORDS:
        for child in schema.get(keyword) or []:
            yield from _iter_subschemas(child)


def _iter_content_schemas(content):
    """Yield unmodified schema roots from an optional OpenAPI content mapping."""
    for media_type in (content or {}).values():
        if isinstance(media_type, dict) and "schema" in media_type:
            yield media_type["schema"]


def _iter_parameter_schemas(parameter):
    """Yield unmodified schema roots when the input is an OpenAPI parameter mapping."""
    if not isinstance(parameter, dict):
        return
    if "schema" in parameter:
        yield parameter["schema"]
    yield from _iter_content_schemas(parameter.get("content"))


def _iter_operation_schemas(operation):
    for parameter in operation.get("parameters") or []:
        yield from _iter_parameter_schemas(parameter)
    request_body = operation.get("requestBody")
    if isinstance(request_body, dict):
        yield from _iter_content_schemas(request_body.get("content"))
    for response in (operation.get("responses") or {}).values():
        if not isinstance(response, dict):
            continue
        yield from _iter_content_schemas(response.get("content"))
        for header in (response.get("headers") or {}).values():
            yield from _iter_parameter_schemas(header)


def _iter_document_schemas(payload):
    """Yield schema roots from a document without recursively duplicating their children."""
    yield from payload["components"]["schemas"].values()
    for path_item in payload["paths"].values():
        for parameter in path_item.get("parameters") or []:
            yield from _iter_parameter_schemas(parameter)
        for method, operation in path_item.items():
            if method in _OPENAPI_METHODS and isinstance(operation, dict):
                yield from _iter_operation_schemas(operation)


def _schema_contract_errors(payload):
    """Report invalid schemas and broken local contracts without changing the document.

    The input has OpenAPI paths and component schemas. Validate each schema tree
    once, then inspect its subschemas for required fields and local references.
    """
    errors = []
    known_refs = {f"#/components/schemas/{name}" for name in payload["components"]["schemas"]}
    roots = list(_iter_document_schemas(payload))
    # check_schema recursively validates children. Batching roots also avoids
    # constructing the meta-schema validator again for every property and ref.
    try:
        Draft202012Validator.check_schema({"$defs": {str(index): schema for index, schema in enumerate(roots)}})
    except SchemaError as exc:
        return [f"malformed schema: {exc}"]
    for schema in (child for root in roots for child in _iter_subschemas(root)):
        required = schema.get("required")
        properties = schema.get("properties")
        if required and isinstance(properties, dict) and not ({"allOf", "anyOf", "oneOf", "$ref"} & schema.keys()):
            missing = sorted(set(required) - set(properties))
            if missing:
                errors.append(f"required properties missing from properties: {missing}")
        ref = schema.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/") and ref not in known_refs:
            errors.append(f"dangling $ref: {ref}")
        discriminator = schema.get("discriminator")
        if isinstance(discriminator, dict):
            for mapped in (discriminator.get("mapping") or {}).values():
                if isinstance(mapped, str) and mapped.startswith("#/components/schemas/") and mapped not in known_refs:
                    errors.append(f"dangling discriminator mapping: {mapped}")
    return errors


def _operation_contract_errors(payload):
    errors = []
    for path, path_item in payload["paths"].items():
        template_parameters = set(re.findall(r"\{([^{}]+)\}", path))
        path_level_parameters = [p for p in path_item.get("parameters") or [] if isinstance(p, dict)]
        for method, operation in path_item.items():
            if method not in _OPENAPI_METHODS or not isinstance(operation, dict):
                continue
            label = f"{method.upper()} {path}"
            if not operation.get("operationId"):
                errors.append(f"{label}: missing operationId")
            responses = operation.get("responses")
            if not responses:
                errors.append(f"{label}: missing responses")
            else:
                for status, response in responses.items():
                    if not isinstance(response, dict) or not response.get("description"):
                        errors.append(f"{label} {status}: response is missing a description")
            parameters = path_level_parameters + [p for p in operation.get("parameters") or [] if isinstance(p, dict)]
            declared = {p.get("name") for p in parameters if p.get("in") == "path"}
            undeclared = sorted(template_parameters - declared)
            if undeclared:
                errors.append(f"{label}: path parameters not declared: {undeclared}")
            for parameter in parameters:
                if parameter.get("in") == "path" and parameter.get("required") is not True:
                    errors.append(f"{label}: path parameter {parameter.get('name')!r} is not required")
    return errors


@pytest.fixture(scope="module")
def generated_specs(tmp_path_factory: pytest.TempPathFactory) -> list[Path]:
    """Spec files written once by ``generate_specs`` for the tests that only read them.

    Each export imports every API surface and takes seconds, so read-only checks share one;
    tests that exercise generation itself still call ``generate_specs`` on their own.
    """
    return _load_generate_swagger_specs_module().generate_specs(tmp_path_factory.mktemp("specs"))


@pytest.mark.timeout(150)  # Two cold, coverage-instrumented CLI exports each have a 60-second limit.
def test_console_stdout_export_contains_both_surfaces_without_spec_files(tmp_path: Path):
    script = Path(__file__).resolve().parents[3] / "dev" / "export_console_openapi.py"
    result = subprocess.run(
        [sys.executable, str(script)], cwd=tmp_path, capture_output=True, text=True, check=True, timeout=60
    )
    documents = json.loads(result.stdout)
    assert set(documents) == {"console", "fast"}
    for document in documents.values():
        assert document["openapi"].startswith("3.")
        assert document["paths"]
        for item in document["paths"].values():
            for operation in item.values():
                if not isinstance(operation, dict) or "responses" not in operation:
                    continue
                origin = operation["x-source-location"]
                source_line = Path(origin["file"]).read_text().splitlines()[origin["line"] - 1].lstrip()
                assert source_line.startswith(("def ", "async def "))
    datasets = documents["console"]["paths"]["/datasets"]["get"]["x-source-location"]
    assert datasets["file"].endswith("/controllers/console/datasets/datasets.py")
    cached_script = script.with_name("cached_console_openapi.py")
    try:
        cached = subprocess.run(
            [sys.executable, str(cached_script)], cwd=tmp_path, capture_output=True, text=True, check=True, timeout=60
        )
        assert json.loads(cached.stdout) == documents
    finally:
        subprocess.run(
            [sys.executable, str(cached_script), "--stop"], cwd=tmp_path, capture_output=True, check=True, timeout=10
        )
    assert not list(tmp_path.rglob("*.json"))


def test_generate_specs_writes_all_openapi_files(generated_specs: list[Path]):
    assert [path.name for path in generated_specs] == [
        "console-openapi.json",
        "web-openapi.json",
        "service-openapi.json",
        "openapi-openapi.json",
        "inner-openapi.json",
    ]

    for path in generated_specs:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["openapi"] == "3.1.0"
        assert "paths" in payload

    inner_path = next(path for path in generated_specs if path.name == "inner-openapi.json")
    inner_payload = json.loads(inner_path.read_text(encoding="utf-8"))
    assert inner_payload["security"] == [{"InnerApiKey": []}]
    assert inner_payload["components"]["securitySchemes"] == {
        "InnerApiKey": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Inner-Api-Key",
            "description": "INNER_API_KEY for enterprise callers; INNER_API_KEY_FOR_PLUGIN for plugin/agent callers.",
        }
    }
    assert "Bearer" not in inner_payload["components"]["securitySchemes"]
    assert "/enterprise/apps/{app_id}/dsl" in inner_payload["paths"]


def test_console_only_export_matches_the_full_export():
    module = _load_generate_swagger_specs_module()
    assert module.export_console_spec() == module.export_specs()["console-openapi.json"]


def test_generate_specs_match_live_openapi_payloads(tmp_path: Path):
    module = _load_generate_swagger_specs_module()
    app = module.create_spec_app()
    client = app.test_client()
    target_apis = module._target_apis()
    for api in target_apis.values():
        _reset_schema_cache(api)
    live_payloads = {target.filename: client.get(target.route).get_json() for target in module.SPEC_TARGETS}

    # Poison the endpoint cache after reading the live contract. The exporter
    # must independently serialize each API instead of succeeding by reading
    # the same cached payload through the HTTP spec route.
    poison_payload = {"poison": "stale schema cache"}
    for api in target_apis.values():
        api._schema = poison_payload
        api.__dict__["__schema__"] = poison_payload
    try:
        for target in module.SPEC_TARGETS:
            response = client.get(target.route)
            assert response.status_code == 200
            assert response.get_json() == poison_payload
        written_paths = module.generate_specs(tmp_path)
    finally:
        for api in target_apis.values():
            _reset_schema_cache(api)

    assert {path.name for path in written_paths} == set(live_payloads)
    for path in written_paths:
        assert json.loads(path.read_text(encoding="utf-8")) == live_payloads[path.name]


@pytest.mark.timeout(75)  # Allow one cold, coverage-instrumented export with its own 60-second limit.
def test_generate_specs_after_controllers_were_imported_with_swagger_disabled(tmp_path: Path):
    api_dir = Path(__file__).resolve().parents[3]
    script = """
import sys
from pathlib import Path

from controllers.console import api as console_api
from controllers.inner_api import api as inner_api
from controllers.openapi import api as openapi_api
from controllers.service_api import api as service_api
from controllers.web import api as web_api

apis = (console_api, web_api, service_api, openapi_api, inner_api)
assert all(api._add_specs is False for api in apis)

from dev.generate_swagger_specs import generate_specs

written_paths = generate_specs(Path(sys.argv[1]))
assert [path.name for path in written_paths] == [
    "console-openapi.json",
    "web-openapi.json",
    "service-openapi.json",
    "openapi-openapi.json",
    "inner-openapi.json",
]
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(api_dir)
    env["SWAGGER_UI_ENABLED"] = "false"

    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=api_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr


def test_apply_runtime_defaults_forces_swagger_routes_on(monkeypatch):
    module = _load_generate_swagger_specs_module()
    from configs import dify_config

    monkeypatch.setenv("SWAGGER_UI_ENABLED", "false")
    apply_config_overrides(monkeypatch, SWAGGER_UI_ENABLED=False)

    module.apply_runtime_defaults()

    assert dify_config.SWAGGER_UI_ENABLED is True


def test_generate_specs_writes_openapi_with_resolvable_references_and_null_defaults(generated_specs: list[Path]):
    for path in generated_specs:
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

    service_payload = json.loads((generated_specs[0].parent / "service-openapi.json").read_text(encoding="utf-8"))
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


def test_generate_specs_writes_unique_operation_ids(generated_specs: list[Path]):
    for path in generated_specs:
        payload = json.loads(path.read_text(encoding="utf-8"))
        operation_ids = list(_operation_ids(payload))

        assert len(operation_ids) == len(set(operation_ids))


def test_finalize_openapi_payload_preserves_canonical_operation_id():
    module = _load_generate_swagger_specs_module()
    payload = {
        "paths": {
            "/items/create-by-file": {
                "post": {"operationId": "create_item", "responses": {"200": {}}},
            },
            "/items/create_by_file": {
                "post": {"deprecated": True, "operationId": "create_item", "responses": {"200": {}}},
            },
        }
    }

    result = module.finalize_openapi_payload(payload)

    assert result["paths"]["/items/create-by-file"]["post"]["operationId"] == "create_item"
    legacy_operation_id = result["paths"]["/items/create_by_file"]["post"]["operationId"]
    assert legacy_operation_id.startswith("create_item_")


def test_finalize_openapi_payload_only_marks_explicit_binary_responses():
    module = _load_generate_swagger_specs_module()
    payload = {
        "paths": {
            "/transport": {
                "get": {
                    "operationId": "get_transport",
                    "responses": {
                        "200": {
                            "content": {
                                "application/octet-stream": {},
                                "application/json; charset=utf-8": {},
                                "application/problem+json": {},
                                "text/event-stream; charset=utf-8": {
                                    "schema": {"$ref": "#/components/schemas/BlockingResponse"}
                                },
                                "text/plain": {},
                            }
                        }
                    },
                    "x-dify-binary-response-media-types": ["application/octet-stream"],
                }
            }
        }
    }

    result = module.finalize_openapi_payload(payload)
    operation = result["paths"]["/transport"]["get"]
    content = operation["responses"]["200"]["content"]

    assert content["application/octet-stream"]["schema"] == {"format": "binary", "type": "string"}
    assert content["text/event-stream; charset=utf-8"]["schema"] == {"type": "string"}
    assert content["application/json; charset=utf-8"] == {}
    assert content["application/problem+json"] == {}
    assert content["text/plain"] == {}
    assert "x-dify-binary-response-media-types" not in operation


def test_console_file_and_audio_responses_declare_binary_success_and_json_errors(generated_specs: list[Path]):
    payload = json.loads((generated_specs[0].parent / "console-openapi.json").read_text(encoding="utf-8"))
    audio_media = {"audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"}
    operations = [
        ("/workspaces/current/plugin/asset", "get", {"application/octet-stream"}),
        ("/workspaces/current/plugin/icon", "get", {"*/*"}),
        ("/workspaces/current/skills/{skill_id}/files/content", "get", {"*/*"}),
        ("/installed-apps/{installed_app_id}/text-to-audio", "post", audio_media),
        ("/trial-apps/{app_id}/text-to-audio", "post", audio_media),
    ]
    for path, method, media_types in operations:
        responses = payload["paths"][path][method]["responses"]
        assert responses["200"]["content"] == {
            media_type: {"schema": {"type": "string", "format": "binary"}} for media_type in media_types
        }, path
        errors = {status: response for status, response in responses.items() if status.startswith(("4", "5"))}
        assert errors, path
        for status, response in errors.items():
            assert set(response["content"]) == {"application/json"}, (path, status)


def test_system_features_specs_exclude_backend_only_fields(generated_specs: list[Path]):
    excluded_fields = {
        "enable_collaboration_mode",
        "enable_trial_app",
        "is_allow_create_workspace",
        "max_plugin_package_size",
        "plugin_manager",
    }

    for spec_name in ("console-openapi.json", "web-openapi.json"):
        spec_path = next(path for path in generated_specs if path.name == spec_name)
        payload = json.loads(spec_path.read_text(encoding="utf-8"))
        schemas = payload["components"]["schemas"]
        system_features_schema = schemas["SystemFeatureModel"]

        assert excluded_fields.isdisjoint(system_features_schema["properties"])
        assert "PluginManagerModel" not in schemas


def test_generate_specs_writes_get_operations_without_request_bodies(generated_specs: list[Path]):
    for path in generated_specs:
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert all("requestBody" not in operation for operation in _get_operations(payload))


def test_generate_specs_include_command_oriented_knowledge_fs_contract(generated_specs: list[Path]):
    openapi_path = next(path for path in generated_specs if path.name == "openapi-openapi.json")
    payload = json.loads(openapi_path.read_text(encoding="utf-8"))
    paths = payload["paths"]
    prefix = "/workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs"

    assert {
        f"{prefix}:cat": "get",
        f"{prefix}:diff": "post",
        f"{prefix}:find": "get",
        f"{prefix}:grep": "get",
        f"{prefix}:ls": "get",
        f"{prefix}:stat": "get",
        f"{prefix}:tree": "get",
    } == {
        path: next(method for method in item if method != "parameters")
        for path, item in paths.items()
        if path.startswith(prefix)
    }
    assert not any("/knowledge-fs/spaces/" in path or "/entries" in path for path in paths)

    list_operation = paths[f"{prefix}:ls"]["get"]
    query_names = {parameter["name"] for parameter in list_operation["parameters"] if parameter["in"] == "query"}
    assert query_names == {"consistency_class", "page_size", "page_token", "path"}
    path_names = {parameter["name"] for parameter in list_operation["parameters"] if parameter["in"] == "path"}
    assert path_names == {"knowledge_space_id", "workspace_id"}
    assert "requestBody" not in list_operation
    assert list_operation["operationId"] == "ls_knowledge_fs"
    assert list_operation["summary"] == "List an Agent Knowledge Base directory (ls)"
    assert "stable Agent Knowledge Base traversal order" in list_operation["description"]
    assert "total is intentionally omitted" in list_operation["description"]
    assert "WORKSPACE_READ" in list_operation["description"]
    assert _response_schema(list_operation)["$ref"] == "#/components/schemas/KnowledgeFSEntryListResponse"
    for status in ("400", "401", "403", "404", "409", "413", "422", "503"):
        assert _response_schema(list_operation, status)["$ref"] == "#/components/schemas/ErrorBody"

    list_schema = payload["components"]["schemas"]["KnowledgeFSEntryListResponse"]
    assert {"data", "has_more", "next_page_token", "path", "truncated"} <= set(list_schema["properties"])
    entry_schema = payload["components"]["schemas"]["KnowledgeFSEntryResponse"]
    assert {item.get("type") for item in entry_schema["properties"]["resource_type"]["anyOf"]} == {
        "null",
        "string",
    }
    metadata_schema = payload["components"]["schemas"]["KnowledgeFSEntryMetadataResponse"]
    assert metadata_schema["properties"]["resource_type"]["type"] == "string"
    assert "enum" not in metadata_schema["properties"]["resource_type"]

    diff_operation = paths[f"{prefix}:diff"]["post"]
    assert diff_operation["operationId"] == "diff_knowledge_fs"
    assert "consume model quota" in diff_operation["description"]
    assert "Automatic retries are not safe" in diff_operation["description"]
    assert _request_schema(diff_operation)["$ref"] == "#/components/schemas/KnowledgeFSEntryComparePayload"
    assert _response_schema(diff_operation)["$ref"] == ("#/components/schemas/KnowledgeFSEntryComparisonResponse")

    tree_operation = paths[f"{prefix}:tree"]["get"]
    assert tree_operation["operationId"] == "tree_knowledge_fs"


@pytest.mark.parametrize(
    ("nested_schema", "expected_error"),
    [
        ({"type": "invalid-type"}, "malformed schema"),
        ({"properties": {}, "required": ["missing"]}, "required properties missing"),
        ({"$ref": "#/components/schemas/Missing"}, "dangling $ref"),
        (
            {"discriminator": {"propertyName": "kind", "mapping": {"cat": "#/components/schemas/Missing"}}},
            "dangling discriminator mapping",
        ),
    ],
)
def test_schema_contract_rejects_invalid_nested_schemas(nested_schema, expected_error):
    """Nested schema defects must remain detectable when validating roots together."""
    payload = {
        "components": {"schemas": {"Envelope": {"properties": {"nested": nested_schema}}}},
        "paths": {},
    }

    assert any(expected_error in error for error in _schema_contract_errors(payload))


@pytest.mark.timeout(60)  # Validate all five exports under coverage, including the large console schema.
def test_generate_specs_produce_valid_openapi_contracts(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    assert len(written_paths) == 5
    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["openapi"].startswith("3."), path.name
        assert payload["paths"], path.name
        assert _schema_contract_errors(payload) == [], path.name
        assert _operation_contract_errors(payload) == [], path.name


def test_generated_request_contracts_accept_and_reject_payloads(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    service_path = next(path for path in written_paths if path.name == "service-openapi.json")
    payload = json.loads(service_path.read_text(encoding="utf-8"))
    schemas = payload["components"]["schemas"]

    file_item_schema = schemas["CompletionRequestPayloadWithUser"]["properties"]["files"]["anyOf"][0]["items"]
    file_validator = Draft202012Validator(file_item_schema)
    valid_file_values = [
        {"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"},
        {"type": "image", "transfer_method": "remote_url", "remote_url": "https://example.com/image.png"},
        {
            "type": "image",
            "transfer_method": "remote_url",
            "upload_file_id": "00000000-0000-0000-0000-000000000001",
        },
        {
            "type": "image",
            "transfer_method": "local_file",
            "upload_file_id": "00000000-0000-0000-0000-000000000001",
            "url": "https://example.com/signed-preview",
        },
    ]
    for value in valid_file_values:
        assert not list(file_validator.iter_errors(value)), value

    invalid_file_values = [
        {"type": "image", "transfer_method": "remote_url"},
        {"type": "image", "transfer_method": "local_file", "url": "https://example.com/image.png"},
    ]
    for value in invalid_file_values:
        assert list(file_validator.iter_errors(value)), value

    user_input_form_schema = schemas["Parameters"]["properties"]["user_input_form"]
    validator = Draft202012Validator(user_input_form_schema)
    form_values = {
        "text-input": "hello",
        "select": "alpha",
        "paragraph": "long text",
        "number": 3.5,
        "external_data_tool": None,
        "file": {"upload_file_id": "file-id"},
        "file-list": [{"upload_file_id": "file-id"}],
        "checkbox": True,
        "json_object": {"key": "value"},
    }
    for form_type, default in form_values.items():
        value = [{form_type: {"label": "Input", "variable": "input", "required": False, "default": default}}]
        assert not list(validator.iter_errors(value)), form_type

    invalid_values = [
        [{"unknown": {"label": "Input", "variable": "input"}}],
        [
            {
                "text-input": {"label": "Text", "variable": "text"},
                "number": {"label": "Number", "variable": "number"},
            }
        ],
    ]
    for value in invalid_values:
        assert list(validator.iter_errors(value)), value


def test_generate_specs_writes_web_file_upload_error_codes(generated_specs: list[Path]):
    web_path = next(path for path in generated_specs if path.name == "web-openapi.json")
    payload = json.loads(web_path.read_text(encoding="utf-8"))

    upload_bad_request = payload["paths"]["/files/upload"]["post"]["responses"]["400"]["description"]
    assert "`file_extension_blocked`" in upload_bad_request


def test_standalone_inline_model_name_includes_list_constraints():
    module = _load_generate_swagger_specs_module()

    from flask_restx import fields

    cases = (
        ({"min_items": 1}, {"min_items": 2}),
        ({"max_items": 1}, {"max_items": 2}),
        ({"unique": True}, {"unique": False}),
    )
    for first_kwargs, second_kwargs in cases:
        first_inline_model = {"items": fields.List(fields.String, **first_kwargs)}
        second_inline_model = {"items": fields.List(fields.String, **second_kwargs)}

        assert module._inline_model_name(first_inline_model) != module._inline_model_name(second_inline_model)


def test_generate_specs_is_idempotent(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    first_paths = module.generate_specs(tmp_path / "first")
    second_paths = module.generate_specs(tmp_path / "second")

    assert [path.name for path in first_paths] == [path.name for path in second_paths]
    for first_path, second_path in zip(first_paths, second_paths, strict=False):
        assert first_path.read_text(encoding="utf-8") == second_path.read_text(encoding="utf-8")


def test_generate_specs_include_agent_v2_knowledge_set_schema_and_query_enums(generated_specs: list[Path]):
    console_path = next(path for path in generated_specs if path.name == "console-openapi.json")
    payload = json.loads(console_path.read_text(encoding="utf-8"))
    schemas = payload["components"]["schemas"]

    assert "AgentKnowledgeSetConfig" in schemas
    assert schemas["AgentSoulKnowledgeConfig"]["properties"]["sets"]["items"]["$ref"] == (
        "#/components/schemas/AgentKnowledgeSetConfig"
    )
    assert schemas["AgentKnowledgeQueryMode"]["enum"] == ["generated_query", "user_query"]


def test_checked_in_agent_v2_knowledge_openapi_and_generated_contracts_are_in_sync():
    api_dir = Path(__file__).resolve().parents[3]
    repo_root = api_dir.parent

    markdown = (api_dir / "openapi" / "markdown" / "console-openapi.md").read_text(encoding="utf-8")
    agent_types = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "agent" / "types.gen.ts"
    ).read_text(encoding="utf-8")
    apps_types = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "apps" / "types.gen.ts"
    ).read_text(encoding="utf-8")
    agent_zod = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "agent" / "zod.gen.ts"
    ).read_text(encoding="utf-8")
    apps_zod = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "apps" / "zod.gen.ts"
    ).read_text(encoding="utf-8")

    assert "#### AgentKnowledgeSetConfig" in markdown
    assert "#### AgentSoulKnowledgeConfig" in markdown
    assert "#### AgentKnowledgeQueryMode" in markdown

    for content in (agent_types, apps_types):
        assert "export type AgentKnowledgeSetConfig = {" in content
        assert "export type AgentSoulKnowledgeConfig = {" in content
        assert "AgentKnowledgeQueryMode" in content
        assert "generated_query" in content
        assert "user_query" in content

    for content in (agent_zod, apps_zod):
        assert "export const zAgentKnowledgeSetConfig = z.object({" in content
        assert "export const zAgentSoulKnowledgeConfig = z.object({" in content
        assert "zAgentKnowledgeQueryMode = z.enum([" in content
        assert "generated_query" in content
        assert "user_query" in content
