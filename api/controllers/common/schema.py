"""Helpers for registering Pydantic models with Flask-RESTX namespaces.

Flask-RESTX treats `SchemaModel` bodies as opaque JSON schemas; it does not
promote Pydantic's nested `$defs` into top-level OpenAPI component schemas.
These helpers keep that translation centralized so models registered through
`register_schema_models` emit resolvable OpenAPI 3 references.
"""

from collections.abc import Iterable, Mapping
from enum import StrEnum
from typing import Any, Literal, NotRequired, Protocol, TypedDict

from flask import request
from flask_restx import Namespace
from pydantic import BaseModel, TypeAdapter

DEFAULT_REF_TEMPLATE_OPENAPI_3_0 = "#/components/schemas/{model}"


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
        "format": NotRequired[str],
        "minimum": NotRequired[int | float],
        "maximum": NotRequired[int | float],
        "exclusiveMinimum": NotRequired[int | float],
        "exclusiveMaximum": NotRequired[int | float],
        "minLength": NotRequired[int],
        "maxLength": NotRequired[int],
        "pattern": NotRequired[str],
        "minItems": NotRequired[int],
        "maxItems": NotRequired[int],
        "uniqueItems": NotRequired[bool],
        "multipleOf": NotRequired[int | float],
    },
)

JsonResponseWithStatus = tuple[dict[str, Any], int]


class QueryArgs(Protocol):
    def to_dict(self, flat: bool = True) -> dict[str, str]: ...

    def getlist(self, key: str) -> list[str]: ...


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


JsonSchemaMode = Literal["validation", "serialization"]


def _register_schema_model(namespace: Namespace, model: type[BaseModel], *, mode: JsonSchemaMode) -> None:
    _register_json_schema(
        namespace,
        model.__name__,
        model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0, mode=mode),
    )


def register_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel and its nested component schemas for OpenAPI documentation."""

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
            TypeAdapter(model).json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0),
        )


def query_params_from_model(model: type[BaseModel]) -> dict[str, QueryParamDoc]:
    """Build Flask-RESTX query parameter docs from a flat Pydantic model.

    `Namespace.expect()` treats Pydantic schema models as request bodies, so GET
    endpoints should keep runtime validation on the Pydantic model and feed this
    derived mapping to `Namespace.doc(params=...)` for OpenAPI documentation.
    """

    schema = model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0)
    definitions = _schema_definitions(schema)
    properties = schema.get("properties", {})
    if not isinstance(properties, Mapping):
        return {}

    required = schema.get("required", [])
    required_names = set(required) if isinstance(required, list) else set()

    params: dict[str, QueryParamDoc] = {}
    for name, property_schema in properties.items():
        if not isinstance(name, str) or not isinstance(property_schema, Mapping):
            continue

        params[name] = _query_param_from_property(
            property_schema,
            required=name in required_names,
            definitions=definitions,
        )

    return params


def query_params_from_request[ModelT: BaseModel](
    model: type[ModelT],
    *,
    list_fields: Iterable[str] = (),
    args: QueryArgs | None = None,
    use_defaults_for_malformed_ints: bool = False,
) -> ModelT:
    """Validate query args with Pydantic while preserving Flask query parsing behavior.

    Repeated params need explicit ``getlist()`` handling because Werkzeug's
    ``to_dict()`` keeps only one value. For malformed scalar integers, Flask's
    For endpoints migrated from ``request.args.get(..., type=int, default=...)``,
    set ``use_defaults_for_malformed_ints`` to preserve Flask's fallback to
    defaults for malformed optional integer params.
    """

    query_args = args or request.args
    params: dict[str, Any] = query_args.to_dict()
    for field_name in list_fields:
        params[field_name] = query_args.getlist(field_name)

    if use_defaults_for_malformed_ints:
        _drop_malformed_defaulted_integer_params(model, params)
    return model.model_validate(params)


def _drop_malformed_defaulted_integer_params(model: type[BaseModel], params: dict[str, Any]) -> None:
    properties = model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0).get("properties", {})
    if not isinstance(properties, Mapping):
        return

    for name, value in list(params.items()):
        if not isinstance(value, str):
            continue

        field = model.model_fields.get(name)
        if field is None or field.is_required():
            continue

        property_schema = properties.get(name)
        if not isinstance(property_schema, Mapping):
            continue

        if _nullable_property_schema(property_schema).get("type") != "integer":
            continue

        try:
            int(value)
        except ValueError:
            params.pop(name)


def _schema_definitions(schema: Mapping[str, Any]) -> Mapping[str, Any]:
    definitions = schema.get("$defs")
    return definitions if isinstance(definitions, Mapping) else {}


def _query_param_from_property(
    property_schema: Mapping[str, Any],
    *,
    required: bool,
    definitions: Mapping[str, Any],
) -> QueryParamDoc:
    param_schema = _resolve_schema_ref(_nullable_property_schema(property_schema), definitions)
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
                item_schema = _resolve_schema_ref(items, definitions)
                item_type = item_schema.get("type")
                if isinstance(item_type, str):
                    param_doc["items"] = {"type": item_type}
                item_enum = item_schema.get("enum")
                if isinstance(item_enum, list):
                    param_doc.setdefault("items", {})["enum"] = item_enum
                item_format = item_schema.get("format")
                if isinstance(item_format, str):
                    param_doc.setdefault("items", {})["format"] = item_format

    enum = param_schema.get("enum")
    if isinstance(enum, list):
        param_doc["enum"] = enum

    default = param_schema.get("default")
    if default is not None:
        param_doc["default"] = default

    schema_format = param_schema.get("format")
    if isinstance(schema_format, str):
        param_doc["format"] = schema_format

    minimum = param_schema.get("minimum")
    if isinstance(minimum, int | float):
        param_doc["minimum"] = minimum

    maximum = param_schema.get("maximum")
    if isinstance(maximum, int | float):
        param_doc["maximum"] = maximum

    exclusive_minimum = param_schema.get("exclusiveMinimum")
    if isinstance(exclusive_minimum, int | float):
        param_doc["exclusiveMinimum"] = exclusive_minimum

    exclusive_maximum = param_schema.get("exclusiveMaximum")
    if isinstance(exclusive_maximum, int | float):
        param_doc["exclusiveMaximum"] = exclusive_maximum

    min_length = param_schema.get("minLength")
    if isinstance(min_length, int):
        param_doc["minLength"] = min_length

    max_length = param_schema.get("maxLength")
    if isinstance(max_length, int):
        param_doc["maxLength"] = max_length

    pattern = param_schema.get("pattern")
    if isinstance(pattern, str):
        param_doc["pattern"] = pattern

    min_items = param_schema.get("minItems")
    if isinstance(min_items, int):
        param_doc["minItems"] = min_items

    max_items = param_schema.get("maxItems")
    if isinstance(max_items, int):
        param_doc["maxItems"] = max_items

    unique_items = param_schema.get("uniqueItems")
    if isinstance(unique_items, bool):
        param_doc["uniqueItems"] = unique_items

    multiple_of = param_schema.get("multipleOf")
    if isinstance(multiple_of, int | float):
        param_doc["multipleOf"] = multiple_of

    return param_doc


def _resolve_schema_ref(property_schema: Mapping[str, Any], definitions: Mapping[str, Any]) -> Mapping[str, Any]:
    ref = property_schema.get("$ref")
    if not isinstance(ref, str):
        return property_schema

    ref_name = ref.rsplit("/", 1)[-1]
    resolved = definitions.get(ref_name)
    if not isinstance(resolved, Mapping):
        return property_schema

    property_without_ref = {key: value for key, value in property_schema.items() if key != "$ref"}
    return {**resolved, **property_without_ref}


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
    "DEFAULT_REF_TEMPLATE_OPENAPI_3_0",
    "get_or_create_model",
    "query_params_from_model",
    "query_params_from_request",
    "register_enum_models",
    "register_response_schema_model",
    "register_response_schema_models",
    "register_schema_model",
    "register_schema_models",
]
