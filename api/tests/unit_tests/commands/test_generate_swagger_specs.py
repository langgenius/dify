"""Unit tests for the standalone OpenAPI export helper."""

import importlib.util
import json
import sys
from pathlib import Path


def _walk_values(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk_values(child)
    elif isinstance(value, list):
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


def test_generate_specs_writes_console_web_and_service_openapi_files(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    assert [path.name for path in written_paths] == [
        "console-openapi.json",
        "web-openapi.json",
        "service-openapi.json",
        "openapi-openapi.json",
    ]

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["openapi"].startswith("3.")
        assert "paths" in payload


def test_generate_specs_writes_openapi_with_resolvable_references_and_no_nulls(tmp_path):
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
        assert all(value is not None for value in _walk_values(payload))


def test_generate_specs_writes_unique_operation_ids(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        operation_ids = list(_operation_ids(payload))

        assert len(operation_ids) == len(set(operation_ids))


def test_generate_specs_writes_get_operations_without_request_bodies(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert all("requestBody" not in operation for operation in _get_operations(payload))


def test_generate_specs_is_idempotent(tmp_path):
    module = _load_generate_swagger_specs_module()

    first_paths = module.generate_specs(tmp_path / "first")
    second_paths = module.generate_specs(tmp_path / "second")

    assert [path.name for path in first_paths] == [path.name for path in second_paths]
    for first_path, second_path in zip(first_paths, second_paths):
        assert first_path.read_text(encoding="utf-8") == second_path.read_text(encoding="utf-8")
