"""Helpers for registering Pydantic models with Flask-RESTX namespaces.

Flask-RESTX treats `SchemaModel` bodies as opaque JSON schemas; it does not
promote Pydantic's nested `$defs` into top-level Swagger `definitions`.
These helpers keep that translation centralized so models registered through
`register_schema_models` emit resolvable Swagger 2.0 references.
"""

from enum import StrEnum

from flask_restx import Namespace
from pydantic import BaseModel, TypeAdapter

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


def _register_json_schema(namespace: Namespace, name: str, schema: dict) -> None:
    """Register a JSON schema and promote any nested Pydantic `$defs`."""

    nested_definitions = schema.get("$defs")
    schema_to_register = dict(schema)
    if isinstance(nested_definitions, dict):
        schema_to_register.pop("$defs")

    namespace.schema_model(name, schema_to_register)

    if not isinstance(nested_definitions, dict):
        return

    for nested_name, nested_schema in nested_definitions.items():
        if isinstance(nested_schema, dict):
            _register_json_schema(namespace, nested_name, nested_schema)


def register_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel and its nested schema definitions for Swagger documentation."""

    _register_json_schema(
        namespace,
        model.__name__,
        model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
    )


def register_schema_models(namespace: Namespace, *models: type[BaseModel]) -> None:
    """Register multiple BaseModels with a namespace."""

    for model in models:
        register_schema_model(namespace, model)


def get_or_create_model(model_name: str, field_def):
    # Import lazily to avoid circular imports between console controllers and schema helpers.
    from controllers.console import console_ns

    existing = console_ns.models.get(model_name)
    if existing is None:
        existing = console_ns.model(model_name, field_def)
    return existing


def register_enum_models(namespace: Namespace, *models: type[StrEnum]) -> None:
    """Register multiple StrEnum with a namespace."""
    for model in models:
        _register_json_schema(
            namespace,
            model.__name__,
            TypeAdapter(model).json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
        )


__all__ = [
    "DEFAULT_REF_TEMPLATE_SWAGGER_2_0",
    "get_or_create_model",
    "register_enum_models",
    "register_schema_model",
    "register_schema_models",
]
