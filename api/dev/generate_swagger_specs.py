"""Generate Flask-RESTX Swagger 2.0 specs without booting the full backend.

This helper intentionally avoids `app_factory.create_app()`. The normal backend
startup eagerly initializes database, Redis, Celery, and storage extensions,
which is unnecessary when the goal is only to serialize the Flask-RESTX
`/swagger.json` documents.
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
from flask_restx.swagger import Swagger

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
    SpecTarget(route="/console/api/swagger.json", filename="console-swagger.json", namespace="console"),
    SpecTarget(route="/api/swagger.json", filename="web-swagger.json", namespace="web"),
    SpecTarget(route="/v1/swagger.json", filename="service-swagger.json", namespace="service"),
)

_ORIGINAL_REGISTER_MODEL = Swagger.register_model
_ORIGINAL_REGISTER_FIELD = Swagger.register_field


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
    """Return a stable Swagger model name for an anonymous inline field map."""

    signature = json.dumps(_inline_model_signature(nested_fields), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"_AnonymousInlineModel_{digest}"


def apply_runtime_defaults() -> None:
    """Force the small config surface required for Swagger generation."""

    os.environ.setdefault("SECRET_KEY", "spec-export")
    os.environ.setdefault("STORAGE_TYPE", "local")
    os.environ.setdefault("STORAGE_LOCAL_PATH", "/tmp/dify-storage")
    os.environ.setdefault("SWAGGER_UI_ENABLED", "true")

    from configs import dify_config

    dify_config.SECRET_KEY = os.environ["SECRET_KEY"]
    dify_config.STORAGE_TYPE = "local"
    dify_config.STORAGE_LOCAL_PATH = os.environ["STORAGE_LOCAL_PATH"]
    dify_config.SWAGGER_UI_ENABLED = os.environ["SWAGGER_UI_ENABLED"].lower() == "true"


def _patch_swagger_for_inline_nested_dicts() -> None:
    """Teach Flask-RESTX Swagger generation to tolerate inline nested field maps.

    Some existing controllers use `fields.Nested({...})` with a raw field mapping
    instead of a named `api.model(...)`. Flask-RESTX crashes on those anonymous
    dicts during schema registration, so this helper upgrades them into temporary
    named models at export time.
    """

    if getattr(Swagger, "_dify_inline_nested_dict_patch", False):
        return

    def get_or_create_inline_model(self: Swagger, nested_fields: dict[object, object]) -> object:
        anonymous_models = getattr(self, "_anonymous_inline_models", None)
        if anonymous_models is None:
            anonymous_models = {}
            self.__dict__["_anonymous_inline_models"] = anonymous_models

        anonymous_name = anonymous_models.get(id(nested_fields))
        if anonymous_name is None:
            anonymous_name = _inline_model_name(nested_fields)
            anonymous_models[id(nested_fields)] = anonymous_name
            if anonymous_name not in self.api.models:
                self.api.model(anonymous_name, nested_fields)

        return self.api.models[anonymous_name]

    def register_model_with_inline_dict_support(self: Swagger, model: object) -> dict[str, str]:
        if _is_inline_field_map(model):
            model = get_or_create_inline_model(self, model)

        return _ORIGINAL_REGISTER_MODEL(self, model)

    def register_field_with_inline_dict_support(self: Swagger, field: object) -> None:
        nested = getattr(field, "nested", None)
        if _is_inline_field_map(nested):
            field.model = get_or_create_inline_model(self, nested)  # type: ignore

        _ORIGINAL_REGISTER_FIELD(self, field)

    Swagger.register_model = register_model_with_inline_dict_support
    Swagger.register_field = register_field_with_inline_dict_support
    Swagger._dify_inline_nested_dict_patch = True


def create_spec_app() -> Flask:
    """Build a minimal Flask app that only mounts the Swagger-producing blueprints."""

    apply_runtime_defaults()
    _patch_swagger_for_inline_nested_dicts()

    app = Flask(__name__)

    from controllers.console import bp as console_bp
    from controllers.console import console_ns
    from controllers.service_api import bp as service_api_bp
    from controllers.service_api import service_api_ns
    from controllers.web import bp as web_bp
    from controllers.web import web_ns

    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)

    for namespace in (console_ns, web_ns, service_api_ns):
        for api in namespace.apis:
            _materialize_inline_model_definitions(api)

    return app


def _registered_models(namespace: str) -> dict[str, object]:
    """Return the Flask-RESTX models registered for a Swagger namespace."""

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

    raise ValueError(f"unknown Swagger namespace: {namespace}")


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
    """Sort order-insensitive Swagger arrays so generated Markdown is stable."""

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


def _merge_registered_definitions(payload: dict[str, object], namespace: str) -> dict[str, object]:
    """Include registered but route-indirect models in the exported Swagger definitions."""

    definitions = payload.setdefault("definitions", {})
    if not isinstance(definitions, dict):
        raise RuntimeError("unexpected Swagger definitions payload")

    for name, model in _registered_models(namespace).items():
        schema = getattr(model, "__schema__", None)
        if isinstance(schema, dict):
            definitions.setdefault(name, schema)

    return payload


def generate_specs(output_dir: Path) -> list[Path]:
    """Write all Swagger specs to `output_dir` and return the written paths."""

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
        payload = _merge_registered_definitions(payload, target.namespace)
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
        help="Directory where the Swagger JSON files will be written.",
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
