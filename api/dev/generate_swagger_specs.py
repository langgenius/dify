"""Generate Flask-RESTX Swagger 2.0 specs without booting the full backend.

This helper intentionally avoids `app_factory.create_app()`. The normal backend
startup eagerly initializes database, Redis, Celery, and storage extensions,
which is unnecessary when the goal is only to serialize the Flask-RESTX
`/swagger.json` documents.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

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


SPEC_TARGETS: tuple[SpecTarget, ...] = (
    SpecTarget(route="/console/api/swagger.json", filename="console-swagger.json"),
    SpecTarget(route="/api/swagger.json", filename="web-swagger.json"),
    SpecTarget(route="/v1/swagger.json", filename="service-swagger.json"),
)

_ORIGINAL_REGISTER_MODEL = Swagger.register_model
_ORIGINAL_REGISTER_FIELD = Swagger.register_field


def _apply_runtime_defaults() -> None:
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
            self._anonymous_inline_models = anonymous_models

        anonymous_name = anonymous_models.get(id(nested_fields))
        if anonymous_name is None:
            anonymous_name = f"_AnonymousInlineModel{len(anonymous_models) + 1}"
            anonymous_models[id(nested_fields)] = anonymous_name
            self.api.model(anonymous_name, nested_fields)

        return self.api.models[anonymous_name]

    def register_model_with_inline_dict_support(self: Swagger, model: object) -> dict[str, str]:
        if isinstance(model, dict):
            model = get_or_create_inline_model(self, model)

        return _ORIGINAL_REGISTER_MODEL(self, model)

    def register_field_with_inline_dict_support(self: Swagger, field: object) -> None:
        nested = getattr(field, "nested", None)
        if isinstance(nested, dict):
            field.model = get_or_create_inline_model(self, nested)  # type: ignore

        _ORIGINAL_REGISTER_FIELD(self, field)

    Swagger.register_model = register_model_with_inline_dict_support
    Swagger.register_field = register_field_with_inline_dict_support
    Swagger._dify_inline_nested_dict_patch = True


def create_spec_app() -> Flask:
    """Build a minimal Flask app that only mounts the Swagger-producing blueprints."""

    _apply_runtime_defaults()
    _patch_swagger_for_inline_nested_dicts()

    app = Flask(__name__)

    from controllers.console import bp as console_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp

    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)

    return app


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
