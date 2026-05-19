"""Helpers for registering Pydantic models with Flask-RESTX namespaces.

Flask-RESTX treats `SchemaModel` bodies as opaque JSON schemas; it does not
promote Pydantic's nested `$defs` into top-level Swagger `definitions`.
These helpers keep that translation centralized so models registered through
`register_schema_models` emit resolvable Swagger 2.0 references.
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Literal, NotRequired, TypedDict

from flask_restx import Namespace
from pydantic import BaseModel, TypeAdapter

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


QueryParamDoc = TypedDict(
    "QueryParamDoc",
    {
        "in": NotRequired[str],
        "type": NotRequired[str],
        "items": NotRequired[dict[str, object]],
        "required": NotRequired[bool],
        "description": NotRequired[str],
        "enum": NotRequired[list[object]],
        "default": NotRequired[object],
        "minimum": NotRequired[int | float],
        "maximum": NotRequired[int | float],
        "minLength": NotRequired[int],
        "maxLength": NotRequired[int],
        "minItems": NotRequired[int],
        "maxItems": NotRequired[int],
    },
)


def _register_json_schema(namespace: Namespace, name: str, schema: dict) -> None:
    """Register a JSON schema and promote any nested Pydantic `$defs`."""

    schema = _swagger_2_compatible_schema(schema)
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


JsonSchemaMode = Literal["validation", "serialization"]


def _register_schema_model(namespace: Namespace, model: type[BaseModel], *, mode: JsonSchemaMode) -> None:
    _register_json_schema(
        namespace,
        model.__name__,
        model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0, mode=mode),
    )


def _swagger_2_compatible_schema(value: Any) -> Any:
    if isinstance(value, list):
        return [_swagger_2_compatible_schema(item) for item in value]

    if not isinstance(value, dict):
        return value

    converted = {key: _swagger_2_compatible_schema(child) for key, child in value.items()}
    any_of = value.get("anyOf")
    if not isinstance(any_of, list):
        return converted

    non_null_candidates = [
        candidate for candidate in any_of if isinstance(candidate, Mapping) and candidate.get("type") != "null"
    ]
    has_null_candidate = any(isinstance(candidate, Mapping) and candidate.get("type") == "null" for candidate in any_of)
    if not has_null_candidate or len(non_null_candidates) != 1:
        return converted

    non_null_schema = _swagger_2_compatible_schema(dict(non_null_candidates[0]))
    if not isinstance(non_null_schema, dict):
        return converted

    converted.pop("anyOf", None)
    converted.update(non_null_schema)
    converted["x-nullable"] = True
    return converted


def register_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel and its nested schema definitions for Swagger documentation."""

    _register_schema_model(namespace, model, mode="validation")


def register_schema_models(namespace: Namespace, *models: type[BaseModel]) -> None:
    """Register multiple BaseModels with a namespace."""

    for model in models:
        register_schema_model(namespace, model)


def register_response_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel using its serialized response shape."""

    _register_schema_model(namespace, model, mode="serialization")


def register_response_schema_models(namespace: Namespace, *models: type[BaseModel]) -> None:
    """Register multiple response BaseModels using their serialized response shape."""

    for model in models:
        register_response_schema_model(namespace, model)


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


def query_params_from_model(model: type[BaseModel]) -> dict[str, QueryParamDoc]:
    """Build Flask-RESTX query parameter docs from a flat Pydantic model.

    `Namespace.expect()` treats Pydantic schema models as request bodies, so GET
    endpoints should keep runtime validation on the Pydantic model and feed this
    derived mapping to `Namespace.doc(params=...)` for Swagger documentation.
    """

    schema = model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
    properties = schema.get("properties", {})
    if not isinstance(properties, Mapping):
        return {}

    required = schema.get("required", [])
    required_names = set(required) if isinstance(required, list) else set()

    params: dict[str, QueryParamDoc] = {}
    for name, property_schema in properties.items():
        if not isinstance(name, str) or not isinstance(property_schema, Mapping):
            continue

        params[name] = _query_param_from_property(property_schema, required=name in required_names)

    return params


def _query_param_from_property(property_schema: Mapping[str, Any], *, required: bool) -> QueryParamDoc:
    param_schema = _nullable_property_schema(property_schema)
    param_doc: QueryParamDoc = {"in": "query", "required": required}

    description = param_schema.get("description")
    if isinstance(description, str):
        param_doc["description"] = description

    schema_type = param_schema.get("type")
    if isinstance(schema_type, str) and schema_type in {"array", "boolean", "integer", "number", "string"}:
        param_doc["type"] = schema_type
        if schema_type == "array":
            items = param_schema.get("items")
            if isinstance(items, Mapping):
                item_type = items.get("type")
                if isinstance(item_type, str):
                    param_doc["items"] = {"type": item_type}

    enum = param_schema.get("enum")
    if isinstance(enum, list):
        param_doc["enum"] = enum

    default = param_schema.get("default")
    if default is not None:
        param_doc["default"] = default

    minimum = param_schema.get("minimum")
    if isinstance(minimum, int | float):
        param_doc["minimum"] = minimum

    maximum = param_schema.get("maximum")
    if isinstance(maximum, int | float):
        param_doc["maximum"] = maximum

    min_length = param_schema.get("minLength")
    if isinstance(min_length, int):
        param_doc["minLength"] = min_length

    max_length = param_schema.get("maxLength")
    if isinstance(max_length, int):
        param_doc["maxLength"] = max_length

    min_items = param_schema.get("minItems")
    if isinstance(min_items, int):
        param_doc["minItems"] = min_items

    max_items = param_schema.get("maxItems")
    if isinstance(max_items, int):
        param_doc["maxItems"] = max_items

    return param_doc


def _nullable_property_schema(property_schema: Mapping[str, Any]) -> Mapping[str, Any]:
    any_of = property_schema.get("anyOf")
    if not isinstance(any_of, list):
        return property_schema

    non_null_candidates = [
        candidate for candidate in any_of if isinstance(candidate, Mapping) and candidate.get("type") != "null"
    ]

    if len(non_null_candidates) == 1:
        return {**property_schema, **non_null_candidates[0]}

    return property_schema


__all__ = [
    "DEFAULT_REF_TEMPLATE_SWAGGER_2_0",
    "get_or_create_model",
    "query_params_from_model",
    "register_enum_models",
    "register_response_schema_model",
    "register_response_schema_models",
    "register_schema_model",
    "register_schema_models",
]
