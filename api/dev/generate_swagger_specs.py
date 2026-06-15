"""Generate Flask-RESTX OpenAPI 3 specs without booting the full backend.

This helper intentionally avoids `app_factory.create_app()`. The normal backend
startup eagerly initializes database, Redis, Celery, and storage extensions,
which is unnecessary when the goal is only to serialize the Flask-RESTX
`/openapi.json` documents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from collections.abc import MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeGuard

from flask import Flask

logger = logging.getLogger(__name__)

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


@dataclass(frozen=True)
class SpecTarget:
    route: str
    filename: str
    namespace: str


class RestxApi(Protocol):
    models: MutableMapping[str, object]

    def model(self, name: str, model: dict[object, object]) -> object: ...


SPEC_TARGETS: tuple[SpecTarget, ...] = (
    SpecTarget(route="/console/api/openapi.json", filename="console-openapi.json", namespace="console"),
    SpecTarget(route="/api/openapi.json", filename="web-openapi.json", namespace="web"),
    SpecTarget(route="/v1/openapi.json", filename="service-openapi.json", namespace="service"),
    SpecTarget(route="/openapi/v1/openapi.json", filename="openapi-openapi.json", namespace="openapi"),
)


def _is_inline_field_map(value: object) -> TypeGuard[dict[object, object]]:
    """Return whether a nested field map is an anonymous inline mapping."""

    from flask_restx.model import Model, OrderedModel

    return isinstance(value, dict) and not isinstance(value, (Model, OrderedModel))


def _jsonable_schema_value(value: object) -> object:
    """Return a deterministic JSON-serializable representation for schema fingerprints."""

    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, list | tuple):
        return [_jsonable_schema_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable_schema_value(item) for key, item in value.items()}
    value_type = type(value)
    return f"<{value_type.__module__}.{value_type.__qualname__}>"


def _field_signature(field: object) -> object:
    """Build a stable signature for a Flask-RESTX field object."""

    from flask_restx import fields
    from flask_restx.model import instance

    field_instance = instance(field)
    signature: dict[str, object] = {
        "class": f"{field_instance.__class__.__module__}.{field_instance.__class__.__qualname__}"
    }

    if isinstance(field_instance, fields.Nested):
        nested = getattr(field_instance, "nested", None)
        if _is_inline_field_map(nested):
            signature["nested"] = _inline_model_signature(nested)
        else:
            signature["nested"] = getattr(
                nested,
                "name",
                f"<{type(nested).__module__}.{type(nested).__qualname__}>",
            )
    elif hasattr(field_instance, "container"):
        signature["container"] = _field_signature(field_instance.container)
    else:
        schema = getattr(field_instance, "__schema__", None)
        if isinstance(schema, dict):
            signature["schema"] = _jsonable_schema_value(schema)

    for attr_name in (
        "attribute",
        "default",
        "description",
        "example",
        "max",
        "min",
        "nullable",
        "readonly",
        "required",
        "title",
    ):
        if hasattr(field_instance, attr_name):
            signature[attr_name] = _jsonable_schema_value(getattr(field_instance, attr_name))

    return signature


def _inline_model_signature(nested_fields: dict[object, object]) -> object:
    """Build a stable signature for an anonymous inline model."""

    return [
        (str(field_name), _field_signature(field))
        for field_name, field in sorted(nested_fields.items(), key=lambda item: str(item[0]))
    ]


def _inline_model_name(nested_fields: dict[object, object]) -> str:
    """Return a stable OpenAPI model name for an anonymous inline field map."""

    signature = json.dumps(_inline_model_signature(nested_fields), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"_AnonymousInlineModel_{digest}"


def apply_runtime_defaults() -> None:
    """Force the small config surface required for OpenAPI generation."""

    os.environ.setdefault("SECRET_KEY", "spec-export")
    os.environ.setdefault("STORAGE_TYPE", "local")
    os.environ.setdefault("STORAGE_LOCAL_PATH", "/tmp/dify-storage")
    os.environ.setdefault("SWAGGER_UI_ENABLED", "true")

    from configs import dify_config

    dify_config.SECRET_KEY = os.environ["SECRET_KEY"]
    dify_config.STORAGE_TYPE = "local"
    dify_config.STORAGE_LOCAL_PATH = os.environ["STORAGE_LOCAL_PATH"]
    dify_config.SWAGGER_UI_ENABLED = os.environ["SWAGGER_UI_ENABLED"].lower() == "true"


def create_spec_app() -> Flask:
    """Build a minimal Flask app that only mounts the OpenAPI-producing blueprints."""

    apply_runtime_defaults()

    from libs.flask_restx_compat import patch_swagger_for_inline_nested_dicts

    patch_swagger_for_inline_nested_dicts()

    app = Flask(__name__)

    from controllers.console import bp as console_bp
    from controllers.console import console_ns
    from controllers.openapi import bp as openapi_bp
    from controllers.openapi import openapi_ns
    from controllers.service_api import bp as service_api_bp
    from controllers.service_api import service_api_ns
    from controllers.web import bp as web_bp
    from controllers.web import web_ns

    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)
    app.register_blueprint(openapi_bp)

    for namespace in (console_ns, web_ns, service_api_ns, openapi_ns):
        for api in namespace.apis:
            _materialize_inline_model_definitions(api)

    return app


def _registered_models(namespace: str) -> dict[str, object]:
    """Return the Flask-RESTX models registered for an OpenAPI namespace."""

    if namespace == "console":
        from controllers.console import console_ns

        models = dict(console_ns.models)
        for api in console_ns.apis:
            models.update(api.models)
        return models
    if namespace == "web":
        from controllers.web import web_ns

        models = dict(web_ns.models)
        for api in web_ns.apis:
            models.update(api.models)
        return models
    if namespace == "service":
        from controllers.service_api import service_api_ns

        models = dict(service_api_ns.models)
        for api in service_api_ns.apis:
            models.update(api.models)
        return models
    if namespace == "openapi":
        from controllers.openapi import openapi_ns

        models = dict(openapi_ns.models)
        for api in openapi_ns.apis:
            models.update(api.models)
        return models

    raise ValueError(f"unknown OpenAPI namespace: {namespace}")


def _materialize_inline_model_definitions(api: RestxApi) -> None:
    """Convert inline `fields.Nested({...})` maps into named API models."""

    from flask_restx import fields
    from flask_restx.model import Model, OrderedModel, instance

    inline_models: dict[int, dict[object, object]] = {}
    inline_model_names: dict[int, str] = {}

    def collect_field(field: object) -> None:
        field_instance = instance(field)
        if isinstance(field_instance, fields.Nested):
            nested = getattr(field_instance, "nested", None)
            if _is_inline_field_map(nested) and id(nested) not in inline_models:
                inline_models[id(nested)] = nested
                for nested_field in nested.values():
                    collect_field(nested_field)

        container = getattr(field_instance, "container", None)
        if container is not None:
            collect_field(container)

    for model in list(api.models.values()):
        if isinstance(model, (Model, OrderedModel)):
            for field in model.values():
                collect_field(field)

    for nested_fields in sorted(inline_models.values(), key=_inline_model_name):
        anonymous_name = _inline_model_name(nested_fields)
        inline_model_names[id(nested_fields)] = anonymous_name
        if anonymous_name not in api.models:
            api.model(anonymous_name, nested_fields)

    def model_name_for(nested_fields: dict[object, object]) -> str:
        anonymous_name = inline_model_names.get(id(nested_fields))
        if anonymous_name is None:
            anonymous_name = _inline_model_name(nested_fields)
            inline_model_names[id(nested_fields)] = anonymous_name
            if anonymous_name not in api.models:
                api.model(anonymous_name, nested_fields)
        return anonymous_name

    def materialize_field(field: object) -> None:
        field_instance = instance(field)
        if isinstance(field_instance, fields.Nested):
            nested = getattr(field_instance, "nested", None)
            if _is_inline_field_map(nested):
                field_instance.model = api.models[model_name_for(nested)]  # type: ignore[attr-defined]

        container = getattr(field_instance, "container", None)
        if container is not None:
            materialize_field(container)

    index = 0
    while index < len(api.models):
        model = list(api.models.values())[index]
        index += 1
        if isinstance(model, (Model, OrderedModel)):
            for field in model.values():
                materialize_field(field)


def drop_null_values(value: object) -> object:
    """Remove JSON null values that make the Markdown converter crash."""

    if isinstance(value, dict):
        return {key: drop_null_values(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [drop_null_values(item) for item in value]
    return value


def sort_openapi_arrays(value: object, *, parent_key: str | None = None) -> object:
    """Sort order-insensitive OpenAPI arrays so generated Markdown is stable."""

    if isinstance(value, dict):
        return {key: sort_openapi_arrays(item, parent_key=key) for key, item in value.items()}
    if not isinstance(value, list):
        return value

    sorted_items = [sort_openapi_arrays(item, parent_key=parent_key) for item in value]
    if parent_key == "parameters":
        return sorted(
            sorted_items,
            key=lambda item: (
                item.get("in", "") if isinstance(item, dict) else "",
                item.get("name", "") if isinstance(item, dict) else "",
                json.dumps(item, sort_keys=True, default=str),
            ),
        )
    if parent_key in {"enum", "required", "schemes", "tags"}:
        string_items = [item for item in sorted_items if isinstance(item, str)]
        if len(string_items) == len(sorted_items):
            return sorted(string_items)
    return sorted_items


def _replace_legacy_refs(value: object) -> object:
    if isinstance(value, dict):
        replaced: dict[object, object] = {}
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str) and item.startswith("#/definitions/"):
                replaced[key] = item.replace("#/definitions/", "#/components/schemas/", 1)
            else:
                replaced[key] = _replace_legacy_refs(item)
        return replaced
    if isinstance(value, list):
        return [_replace_legacy_refs(item) for item in value]
    return value


HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}


def _deduplicate_operation_ids(payload: dict[str, object]) -> dict[str, object]:
    """Make operationId values unique while preserving already-unique IDs."""

    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return payload

    operations_by_id: dict[str, list[tuple[str, str, dict[str, object]]]] = {}
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if isinstance(operation_id, str):
                operations_by_id.setdefault(operation_id, []).append((method, path, operation))

    for operation_id, operations in operations_by_id.items():
        if len(operations) < 2:
            continue
        for method, path, operation in operations:
            digest = hashlib.sha1(f"{method}:{path}".encode()).hexdigest()[:8]
            operation["operationId"] = f"{operation_id}_{digest}"

    return payload


def _component_schemas(payload: dict[str, object]) -> dict[str, object]:
    components = payload.setdefault("components", {})
    if not isinstance(components, dict):
        raise RuntimeError("unexpected OpenAPI components payload")

    schemas = components.setdefault("schemas", {})
    if not isinstance(schemas, dict):
        raise RuntimeError("unexpected OpenAPI component schemas payload")

    return schemas


def _merge_registered_schemas(payload: dict[str, object], namespace: str) -> dict[str, object]:
    """Include registered but route-indirect models in exported OpenAPI schemas."""

    schemas = _component_schemas(payload)

    for name, model in _registered_models(namespace).items():
        schema = getattr(model, "__schema__", None)
        if isinstance(schema, dict):
            schemas.setdefault(name, _replace_legacy_refs(schema))

    payload.pop("definitions", None)
    payload = _replace_legacy_refs(payload)  # type: ignore[assignment]

    return payload


def generate_specs(output_dir: Path) -> list[Path]:
    """Write all OpenAPI specs to `output_dir` and return the written paths."""

    output_dir.mkdir(parents=True, exist_ok=True)

    app = create_spec_app()
    client = app.test_client()

    written_paths: list[Path] = []
    for target in SPEC_TARGETS:
        response = client.get(target.route)
        if response.status_code != 200:
            raise RuntimeError(f"failed to fetch {target.route}: {response.status_code}")

        payload = response.get_json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"unexpected response payload for {target.route}")
        payload = _merge_registered_schemas(payload, target.namespace)
        payload = _deduplicate_operation_ids(payload)
        payload = drop_null_values(payload)
        payload = sort_openapi_arrays(payload)

        output_path = output_dir / target.filename
        output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written_paths.append(output_path)

    return written_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("openapi"),
        help="Directory where the OpenAPI JSON files will be written.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    written_paths = generate_specs(args.output_dir)

    for path in written_paths:
        logger.debug(path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
