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
from flask_restx import Api
from flask_restx.swagger import Swagger

logger = logging.getLogger(__name__)

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from libs.flask_restx_compat import finalize_openapi_payload


@dataclass(frozen=True)
class SpecTarget:
    route: str
    filename: str


class RestxApi(Protocol):
    models: MutableMapping[str, object]

    def model(self, name: str, model: dict[object, object]) -> object: ...


SPEC_TARGETS: tuple[SpecTarget, ...] = (
    SpecTarget(route="/console/api/openapi.json", filename="console-openapi.json"),
    SpecTarget(route="/api/openapi.json", filename="web-openapi.json"),
    SpecTarget(route="/v1/openapi.json", filename="service-openapi.json"),
    SpecTarget(route="/openapi/v1/openapi.json", filename="openapi-openapi.json"),
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
        "max_items",
        "min",
        "min_items",
        "nullable",
        "readonly",
        "required",
        "title",
        "unique",
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

    from configs import dify_config

    dify_config.SECRET_KEY = os.environ["SECRET_KEY"]
    dify_config.STORAGE_TYPE = "local"
    dify_config.STORAGE_LOCAL_PATH = os.environ["STORAGE_LOCAL_PATH"]
    dify_config.SWAGGER_UI_ENABLED = True


def create_spec_app() -> Flask:
    """Build a minimal Flask app that only mounts the OpenAPI-producing blueprints."""

    apply_runtime_defaults()

    from libs.flask_restx_compat import install_swagger_compatibility

    install_swagger_compatibility()

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


def _target_apis() -> dict[str, Api]:
    """Return the API instance that owns each exported OpenAPI target."""

    from controllers.console import api as console_api
    from controllers.openapi import api as openapi_api
    from controllers.service_api import api as service_api
    from controllers.web import api as web_api

    return {
        "/console/api/openapi.json": console_api,
        "/api/openapi.json": web_api,
        "/v1/openapi.json": service_api,
        "/openapi/v1/openapi.json": openapi_api,
    }


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


def generate_specs(output_dir: Path) -> list[Path]:
    """Write all OpenAPI specs to `output_dir` and return the written paths."""

    output_dir.mkdir(parents=True, exist_ok=True)

    app = create_spec_app()
    target_apis = _target_apis()

    written_paths: list[Path] = []
    for target in SPEC_TARGETS:
        # Build directly from the API instance instead of depending on the
        # optional HTTP spec route. ExternalApi decides whether to register
        # that route when controller modules are first imported, which may
        # happen before this exporter forces its generation-only defaults.
        with app.test_request_context(target.route):
            payload = Swagger(target_apis[target.route]).as_dict()
        payload = finalize_openapi_payload(payload)

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
