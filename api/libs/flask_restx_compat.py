"""Compatibility helpers for Dify's Flask-RESTX Swagger integration.

These helpers are temporary bridges for legacy Flask-RESTX field contracts
while controllers migrate their request and response documentation to Pydantic
models. Keep the behavior centralized so live Swagger endpoints and offline
spec export fail or succeed in the same way.
"""

from flask import current_app
from flask_restx.swagger import Swagger


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
        anonymous_models = getattr(self, "_anonymous_inline_models", None)
        if anonymous_models is None:
            anonymous_models = {}
            self._anonymous_inline_models = anonymous_models  # type: ignore[missing-attribute]

        anonymous_name = anonymous_models.get(id(nested_fields))
        if anonymous_name is None:
            anonymous_name = f"_AnonymousInlineModel{len(anonymous_models) + 1}"
            anonymous_models[id(nested_fields)] = anonymous_name
            self.api.model(anonymous_name, nested_fields)

        return self.api.models[anonymous_name]

    def register_model_with_inline_dict_support(self: Swagger, model: object) -> dict[str, str]:
        if isinstance(model, dict):
            model = get_or_create_inline_model(self, model)

        return original_register_model(self, model)

    def register_field_with_inline_dict_support(self: Swagger, field: object) -> None:
        nested = getattr(field, "nested", None)
        if isinstance(nested, dict):
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
