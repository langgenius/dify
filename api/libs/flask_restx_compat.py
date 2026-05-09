"""Compatibility helpers for Dify's Flask-RESTX Swagger integration.

These helpers are temporary bridges for legacy Flask-RESTX field contracts
while controllers migrate their request and response documentation to Pydantic
models. Keep the behavior centralized so live Swagger endpoints and offline
spec export fail or succeed in the same way.
"""

import hashlib
import json
from typing import TypeGuard

from flask import current_app
from flask_restx import fields
from flask_restx.model import Model, OrderedModel, instance
from flask_restx.swagger import Swagger


def _is_inline_field_map(value: object) -> TypeGuard[dict[object, object]]:
    """Return whether a nested field map is an anonymous inline mapping."""

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
    """Return a stable Swagger model name for an anonymous inline field map."""

    signature = json.dumps(_inline_model_signature(nested_fields), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"_AnonymousInlineModel_{digest}"


def patch_swagger_for_inline_nested_dicts() -> None:
    """Allow Swagger generation to handle legacy inline Flask-RESTX field dicts.

    Some existing controllers use raw field mappings in `fields.Nested({...})`
    or directly in `@namespace.response(...)`. Runtime marshalling accepts that,
    but Flask-RESTX Swagger registration expects a named model. Convert those
    anonymous mappings into temporary named models during docs generation.
    """

    if getattr(Swagger, "_dify_inline_nested_dict_patch", False):
        return

    original_register_model = Swagger.register_model
    original_register_field = Swagger.register_field
    original_as_dict = Swagger.as_dict

    def get_or_create_inline_model(self: Swagger, nested_fields: dict[object, object]) -> object:
        anonymous_name = _inline_model_name(nested_fields)
        if anonymous_name not in self.api.models:
            self.api.model(anonymous_name, nested_fields)

        return self.api.models[anonymous_name]

    def register_model_with_inline_dict_support(self: Swagger, model: object) -> dict[str, str]:
        if _is_inline_field_map(model):
            model = get_or_create_inline_model(self, model)

        return original_register_model(self, model)

    def register_field_with_inline_dict_support(self: Swagger, field: object) -> None:
        nested = getattr(field, "nested", None)
        if _is_inline_field_map(nested):
            field.model = get_or_create_inline_model(self, nested)  # type: ignore[attr-defined]

        original_register_field(self, field)

    def as_dict_with_inline_dict_support(self: Swagger):
        # Temporary set RESTX_INCLUDE_ALL_MODELS = false to prevent "length changed while iterating" error
        include_all_models = current_app.config.get("RESTX_INCLUDE_ALL_MODELS", False)
        current_app.config["RESTX_INCLUDE_ALL_MODELS"] = False
        try:
            return original_as_dict(self)
        finally:
            current_app.config["RESTX_INCLUDE_ALL_MODELS"] = include_all_models

    Swagger.register_model = register_model_with_inline_dict_support
    Swagger.register_field = register_field_with_inline_dict_support
    Swagger.as_dict = as_dict_with_inline_dict_support
    Swagger._dify_inline_nested_dict_patch = True
