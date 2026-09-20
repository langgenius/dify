"""Shared builders for the adjacent test modules."""

import importlib.util
import sys
from pathlib import Path


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


def _nullable_schema_ref(schema):
    if "$ref" in schema:
        return schema["$ref"]
    return next(item["$ref"] for item in schema["anyOf"] if "$ref" in item)


def _reset_schema_cache(api):
    api._schema = None
    api.__dict__.pop("__schema__", None)
