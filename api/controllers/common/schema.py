"""Helpers for registering Pydantic models with Flask-RESTX namespaces.

Flask-RESTX treats `SchemaModel` bodies as opaque JSON schemas; it does not
promote Pydantic's nested `$defs` into top-level OpenAPI component schemas.
These helpers keep that translation centralized so models registered through
`register_schema_models` emit resolvable OpenAPI 3 references.
"""

import re
from collections.abc import Iterable, Mapping
from enum import StrEnum
from typing import Any, Literal, NotRequired, Protocol, TypedDict, override
from weakref import WeakKeyDictionary

from flask import request
from flask_restx import Namespace
from pydantic import BaseModel, TypeAdapter
from pydantic.json_schema import CoreModeRef, DefsRef, GenerateJsonSchema

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


class SchemaNameCollisionError(ValueError):
    """Raised when two different schemas would be published under the same OpenAPI component name."""


# Pydantic names `$defs` after the bare class name and only qualifies them when two
# same-named types meet inside one schema, so the same type can surface under different
# names depending on which model pulled it in. Types that share a class name with
# another documented type get a fixed, unique component name here instead.
SCHEMA_NAME_OVERRIDES: Mapping[str, str] = {
    "services.agent_config_service.AgentConfigVersionKind": "AgentConfigTargetVersionKind",
    "graphon.model_runtime.entities.common_entities.I18nObject": "ModelRuntimeI18nObject",
    "services.knowledge.entities.knowledge_entities.FileInfo": "KnowledgeFileInfo",
    "core.plugin.entities.plugin.PluginDependency.Github": "PluginDependencyGithub",
    "core.plugin.entities.plugin.PluginDependency.Marketplace": "PluginDependencyMarketplace",
    "core.plugin.entities.plugin.PluginDependency.Package": "PluginDependencyPackage",
    "core.plugin.entities.bundle.PluginBundleDependency.Github": "PluginBundleDependencyGithub",
    "core.plugin.entities.bundle.PluginBundleDependency.Marketplace": "PluginBundleDependencyMarketplace",
    "core.plugin.entities.bundle.PluginBundleDependency.Package": "PluginBundleDependencyPackage",
    "core.app.entities.task_entities.WorkflowAppBlockingResponse.Data": "WorkflowAppBlockingResponseData",
}

_REF_ID_SUFFIX = re.compile(r":\d+(?=$|[\[\],])")
_MODULE_PREFIX = re.compile(r"(?:[^.[\],]+\.)+([^.[\],]+)")

# Normalized component name -> (component name, fully qualified source type, schema), per namespace.
_registered_schemas: WeakKeyDictionary[Namespace, dict[str, tuple[str, str, dict]]] = WeakKeyDictionary()
_NON_ALPHANUMERIC = re.compile(r"[^a-z0-9]")


def _normalized_schema_name(name: str) -> str:
    """Fold names that client code generators turn into the same identifier (`JSONValue` / `JsonValue`)."""

    return _NON_ALPHANUMERIC.sub("", name.lower())


class _OpenApiJsonSchemaGenerator(GenerateJsonSchema):
    """Emit stable component names and remember which type produced each of them."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.schema_sources: dict[str, str] = {}

    @override
    def get_defs_ref(self, core_mode_ref: CoreModeRef) -> DefsRef:
        core_ref, _mode = core_mode_ref
        source = _REF_ID_SUFFIX.sub("", core_ref)
        name = SCHEMA_NAME_OVERRIDES.get(source) or self.normalize_name(_MODULE_PREFIX.sub(r"\1", source))
        existing_source = self.schema_sources.setdefault(name, source)
        if existing_source != source:
            raise SchemaNameCollisionError(
                f"OpenAPI schema name {name!r} is produced by both {existing_source} and {source}; "
                "rename one of them or add it to SCHEMA_NAME_OVERRIDES."
            )
        defs_ref = DefsRef(name)
        self._prioritized_defsref_choices[defs_ref] = [defs_ref]
        return defs_ref


def _register_json_schema(namespace: Namespace, name: str, schema: dict, sources: Mapping[str, str]) -> None:
    """Register a JSON schema and promote any nested Pydantic `$defs`.

    `sources` maps each component name to the type that produced it. Flask-RESTX keeps
    one flat model namespace, so a second registration under an existing name would
    silently replace the first. Re-registering the same type with the same schema is a
    no-op; a different type, or the same type with a different shape (for example a
    response model also registered in validation mode), raises instead.
    """

    nested_definitions = schema.get("$defs")
    schema_to_register = dict(schema)
    if isinstance(nested_definitions, dict):
        schema_to_register.pop("$defs")

    source = sources.get(name, name)
    registered = _registered_schemas.setdefault(namespace, {})
    normalized_name = _normalized_schema_name(name)
    existing = registered.get(normalized_name)
    if existing is not None and existing != (name, source, schema_to_register):
        existing_name, existing_source, _ = existing
        if existing_name != name:
            reason = f"collides with {existing_name!r} from {existing_source} once normalized by client generators"
        elif existing_source != source:
            reason = f"is produced by both {existing_source} and {source}"
        else:
            reason = f"is registered by {source} with two different shapes (validation vs serialization mode?)"
        raise SchemaNameCollisionError(
            f"OpenAPI schema name {name!r} in namespace {namespace.name!r} {reason}; give each shape its own "
            "class name, add it to SCHEMA_NAME_OVERRIDES, or register response models only with "
            "register_response_schema_models."
        )
    registered[normalized_name] = (name, source, schema_to_register)

    namespace.schema_model(name, schema_to_register)

    if not isinstance(nested_definitions, dict):
        return

    for nested_name, nested_schema in nested_definitions.items():
        if isinstance(nested_schema, dict):
            _register_json_schema(namespace, nested_name, nested_schema, sources)


JsonSchemaMode = Literal["validation", "serialization"]


def _register_type_schema(namespace: Namespace, source_type: type, *, mode: JsonSchemaMode) -> None:
    generator = _OpenApiJsonSchemaGenerator(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0)
    schema = generator.generate(TypeAdapter(source_type).core_schema, mode=mode)
    _register_json_schema(
        namespace,
        source_type.__name__,
        schema,
        {**generator.schema_sources, source_type.__name__: f"{source_type.__module__}.{source_type.__qualname__}"},
    )


def register_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel and its nested component schemas for OpenAPI documentation."""

    _register_type_schema(namespace, model, mode="validation")


def register_schema_models(namespace: Namespace, *models: type[BaseModel]) -> None:
    """Register multiple BaseModels with a namespace."""

    for model in models:
        register_schema_model(namespace, model)


def register_response_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a BaseModel using its serialized response shape."""

    _register_type_schema(namespace, model, mode="serialization")


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
        _register_type_schema(namespace, model, mode="validation")


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
                item_doc = _query_param_item_schema(item_schema)
                if item_doc:
                    param_doc["items"] = item_doc

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


def _query_param_item_schema(item_schema: Mapping[str, Any]) -> dict[str, object]:
    item_doc: dict[str, object] = {}

    for key in ("type", "format", "pattern"):
        value = item_schema.get(key)
        if isinstance(value, str):
            item_doc[key] = value

    enum = item_schema.get("enum")
    if isinstance(enum, list):
        item_doc["enum"] = enum

    for key in ("minLength", "maxLength"):
        value = item_schema.get(key)
        if isinstance(value, int):
            item_doc[key] = value

    for key in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"):
        value = item_schema.get(key)
        if isinstance(value, int | float):
            item_doc[key] = value

    return item_doc


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
    "SCHEMA_NAME_OVERRIDES",
    "SchemaNameCollisionError",
    "get_or_create_model",
    "query_params_from_model",
    "query_params_from_request",
    "register_enum_models",
    "register_response_schema_model",
    "register_response_schema_models",
    "register_schema_model",
    "register_schema_models",
]
