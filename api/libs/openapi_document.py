"""Typed access to the OpenAPI documents the API blueprints render.

The renderers hand back plain JSON objects. Walking them as ``object`` and
re-checking the same keys and value types at every use site spreads one
document shape across every caller, so this module parses a rendered document
once at the boundary and exposes the parts callers actually read.

The document stays open by design: OpenAPI is an extensible format, and the
exporters deliberately keep vendor extensions, so only the structure this
module models is narrowed.
"""

from dataclasses import dataclass
from typing import Final, TypedDict

from pydantic import TypeAdapter

#: Any value an OpenAPI document can hold.
#:
#: A rendered document is JSON, so the union is closed on the JSON types.
#: Callers narrow with the accessors below instead of indexing blind.
type OpenAPIJSON = str | int | float | bool | None | list[OpenAPIJSON] | dict[str, OpenAPIJSON]

#: One JSON Schema fragment: schema keywords mapped to JSON values.
type OpenAPISchema = dict[str, OpenAPIJSON]

#: One operation object, keyed by ``requestBody``, ``responses``, ...
type OpenAPIOperation = dict[str, OpenAPIJSON]

#: One ``paths`` entry, keyed by lower-case HTTP method.
type OpenAPIPathItem = dict[str, OpenAPIOperation]

#: The top level of a rendered document.
type OpenAPIRawDocument = dict[str, OpenAPIJSON]

#: One entry of an operation's ``parameters`` array.
#:
#: Declared functionally because ``in`` is a Python keyword; entries are built
#: from mapping literals so the key keeps its OpenAPI spelling.
OpenAPIParameter = TypedDict(
    "OpenAPIParameter",
    {
        "name": str,
        "in": str,
        "description": str,
        "required": bool,
        "schema": OpenAPISchema,
    },
)

_RAW_DOCUMENT_ADAPTER: Final[TypeAdapter[OpenAPIRawDocument]] = TypeAdapter(OpenAPIRawDocument)


class OpenAPIStructureError(ValueError):
    """A rendered document does not have the structure the OpenAPI format requires."""


@dataclass(frozen=True, slots=True)
class OpenAPIDocument:
    """A rendered OpenAPI document, parsed once.

    ``raw`` keeps the whole document for assertions on top-level fields.
    ``paths`` and ``schemas`` are the two subtrees tests read repeatedly.
    """

    raw: OpenAPIRawDocument
    paths: dict[str, OpenAPIPathItem]
    schemas: dict[str, OpenAPISchema]


def _require_mapping(value: OpenAPIJSON, what: str) -> OpenAPIRawDocument:
    if not isinstance(value, dict):
        raise OpenAPIStructureError(f"expected {what} to be an object, got {type(value).__name__}")
    return value


def _require_array(value: OpenAPIJSON, what: str) -> list[OpenAPIJSON]:
    if not isinstance(value, list):
        raise OpenAPIStructureError(f"expected {what} to be an array, got {type(value).__name__}")
    return value


def _require_string(value: OpenAPIJSON, what: str) -> str:
    if not isinstance(value, str):
        raise OpenAPIStructureError(f"expected {what} to be a string, got {type(value).__name__}")
    return value


def _parse_path_item(path: str, raw: OpenAPIJSON) -> OpenAPIPathItem:
    """Return the path item's operations.

    A path item may also carry non-operation members such as a shared
    ``parameters`` array; those are not operations and are dropped here.
    """
    item: OpenAPIPathItem = {}
    for method, raw_operation in _require_mapping(raw, f"paths[{path}]").items():
        if isinstance(raw_operation, dict):
            item[method] = _require_mapping(raw_operation, f"paths[{path}][{method}]")
    return item


def parse_openapi_document(raw: object) -> OpenAPIDocument:
    """Parse a document decoded from the exported or served OpenAPI JSON.

    Args:
        raw: The result of ``json.loads`` on a rendered document.

    Returns:
        The parsed document.

    Raises:
        pydantic.ValidationError: ``raw`` holds a value JSON cannot represent.
        OpenAPIStructureError: ``paths`` or ``components`` is not an object.
    """
    document = _RAW_DOCUMENT_ADAPTER.validate_python(raw)

    paths: dict[str, OpenAPIPathItem] = {}
    for path, path_item in _require_mapping(document.get("paths", {}), "paths").items():
        paths[path] = _parse_path_item(path, path_item)

    components = _require_mapping(document.get("components", {}), "components")
    schemas: dict[str, OpenAPISchema] = {}
    for name, schema in _require_mapping(components.get("schemas", {}), "components.schemas").items():
        schemas[name] = _require_mapping(schema, f"components.schemas[{name}]")

    return OpenAPIDocument(raw=document, paths=paths, schemas=schemas)


def _operation_object(operation: OpenAPIJSON) -> OpenAPIRawDocument:
    """Return ``operation`` as an object, naming it as the boundary it is."""
    return _require_mapping(operation, "operation")


def operation_at(document: OpenAPIDocument, path: str, method: str) -> OpenAPIOperation:
    """Return the operation object at ``path`` and ``method``.

    Raises:
        KeyError: The document has no such path or method.
    """
    return document.paths[path][method]


def lookup(value: OpenAPIJSON, *path: str | int, default: OpenAPIJSON = None) -> OpenAPIJSON:
    """Follow ``path`` through a document value and return what it names.

    Use this for the one-off assertions on fields this module does not model;
    the accessors below name the shapes tests read repeatedly.

    Args:
        value: A value taken from a parsed document.
        path: Object keys and array indexes to follow, in order.
        default: The value to return when a step names an absent object key.

    Returns:
        The named value, or ``default`` when a step names an absent object key.

    Raises:
        OpenAPIStructureError: A step needs an object or array the value is not.
        IndexError: An array index is out of range.
    """
    current = value
    for step in path:
        if isinstance(step, int):
            if not isinstance(current, list):
                raise OpenAPIStructureError(f"expected a list before index {step}, got {type(current).__name__}")
            current = current[step]
        else:
            if not isinstance(current, dict):
                raise OpenAPIStructureError(f"expected an object before key {step!r}, got {type(current).__name__}")
            if step not in current:
                return default
            current = current[step]
    return current


def object_at(value: OpenAPIJSON, *path: str) -> OpenAPIRawDocument:
    """Return the object ``path`` names, so callers need no runtime assert.

    Raises:
        OpenAPIStructureError: A step is missing or names a non-object.
    """
    named = lookup(value, *path)
    if not isinstance(named, dict):
        raise OpenAPIStructureError(f"expected {'.'.join(path)} to be an object, got {type(named).__name__}")
    return named


def array_at(value: OpenAPIJSON, *path: str) -> list[OpenAPIJSON]:
    """Return the array ``path`` names.

    Raises:
        OpenAPIStructureError: A step is missing or names a non-array.
    """
    named = lookup(value, *path)
    if not isinstance(named, list):
        raise OpenAPIStructureError(f"expected {'.'.join(path)} to be an array, got {type(named).__name__}")
    return named


def text_at(value: OpenAPIJSON, *path: str) -> str:
    """Return the string ``path`` names.

    Raises:
        OpenAPIStructureError: A step is missing or names a non-string.
    """
    named = lookup(value, *path)
    if not isinstance(named, str):
        raise OpenAPIStructureError(f"expected {'.'.join(path)} to be a string, got {type(named).__name__}")
    return named


def _document_object(document: OpenAPIDocument | OpenAPIJSON) -> OpenAPIRawDocument:
    """Return the raw document object behind ``document``.

    Callers may hold either the parsed document or the raw mapping a helper
    received, so both are accepted here and only this boundary narrows.
    """
    if isinstance(document, OpenAPIDocument):
        return document.raw
    return _require_mapping(document, "document")


def _paths_of(document: OpenAPIDocument | OpenAPIJSON) -> dict[str, OpenAPIPathItem]:
    """Return the document's ``paths`` object."""
    paths_object = _require_mapping(_document_object(document).get("paths"), "paths")
    return {path: _parse_path_item(path, item) for path, item in paths_object.items()}


def all_operations(document: OpenAPIDocument | OpenAPIJSON) -> list[tuple[str, str, OpenAPIOperation]]:
    """Return every declared operation as a ``(path, method, operation)`` triple."""
    return [
        (path, method, operation) for path, item in _paths_of(document).items() for method, operation in item.items()
    ]


def operations_of(document: OpenAPIDocument | OpenAPIJSON) -> list[tuple[str, OpenAPIOperation]]:
    """Return every ``GET`` operation as a ``(path, operation)`` pair."""
    return [(path, item["get"]) for path, item in _paths_of(document).items() if "get" in item]


def request_body_schema(operation: OpenAPIJSON, media_type: str) -> OpenAPISchema:
    """Return the schema a request body declares for ``media_type``.

    Args:
        operation: A parsed operation object.
        media_type: The exact media type, e.g. ``application/json``.

    Raises:
        OpenAPIStructureError: The operation has no such request body schema.
    """
    request_body = _require_mapping(_operation_object(operation).get("requestBody"), "requestBody")
    content = _require_mapping(request_body.get("content"), "requestBody.content")
    media = _require_mapping(content.get(media_type), f"requestBody.content[{media_type}]")
    return _require_mapping(media.get("schema"), f"requestBody.content[{media_type}].schema")


def _response_body(operation: OpenAPIJSON, status_code: str) -> OpenAPIRawDocument:
    responses = _require_mapping(_operation_object(operation).get("responses"), "responses")
    response = _require_mapping(responses.get(status_code), f"responses[{status_code}]")
    return _require_mapping(response.get("content"), f"responses[{status_code}].content")


def response_content_types(operation: OpenAPIJSON, status_code: str = "200") -> set[str]:
    """Return the media types a response declares.

    Raises:
        OpenAPIStructureError: The operation has no such response.
    """
    return set(_response_body(operation, status_code))


def response_schema(
    operation: OpenAPIJSON, status_code: str = "200", media_type: str = "application/json"
) -> OpenAPISchema:
    """Return the schema a response declares for ``media_type``.

    Raises:
        OpenAPIStructureError: The operation has no such response schema.
    """
    content = _response_body(operation, status_code)
    media = _require_mapping(content.get(media_type), f"responses[{status_code}].content[{media_type}]")
    return _require_mapping(media.get("schema"), f"responses[{status_code}].content[{media_type}].schema")


def parameters_by_name(operation: OpenAPIJSON) -> dict[str, OpenAPIParameter]:
    """Index an operation's parameters by name.

    Parameters without a string ``name`` are skipped, which is how the renderer
    emits unresolved references.
    """
    indexed: dict[str, OpenAPIParameter] = {}
    for parameter in _require_array(_operation_object(operation).get("parameters", []), "parameters"):
        raw_parameter = _require_mapping(parameter, "parameters[]")
        name = raw_parameter.get("name")
        if isinstance(name, str):
            indexed[name] = OpenAPIParameter(
                {
                    "name": name,
                    "in": _require_string(raw_parameter.get("in"), f"parameters[{name}].in"),
                    "description": _require_string(
                        raw_parameter.get("description", ""), f"parameters[{name}].description"
                    ),
                    "required": raw_parameter.get("required") is True,
                    "schema": _require_mapping(raw_parameter.get("schema", {}), f"parameters[{name}].schema"),
                }
            )
    return indexed


def properties_of(schema: OpenAPIJSON) -> dict[str, OpenAPISchema]:
    """Return a schema's ``properties`` map.

    Raises:
        OpenAPIStructureError: ``properties`` is not an object.
    """
    properties: dict[str, OpenAPISchema] = {}
    for name, property_schema in _require_mapping(
        _require_mapping(schema, "schema").get("properties", {}), "properties"
    ).items():
        properties[name] = _require_mapping(property_schema, f"properties[{name}]")
    return properties


def required_of(schema: OpenAPIJSON) -> list[str]:
    """Return a schema's ``required`` names, empty when it declares none."""
    return [
        _require_string(name, "required[]")
        for name in _require_array(_require_mapping(schema, "schema").get("required", []), "required")
    ]


def variants_of(schema: OpenAPIJSON, field: str = "anyOf") -> list[OpenAPISchema]:
    """Return the alternative schemas a schema lists under ``field``."""
    return [
        _require_mapping(variant, f"{field}[]")
        for variant in _require_array(_require_mapping(schema, "schema").get(field, []), field)
    ]


def resolve_schema(document: OpenAPIDocument | OpenAPIJSON, schema: OpenAPIJSON) -> OpenAPISchema:
    """Resolve a schema that may be a ``$ref`` into its component schema.

    Returns:
        The referenced component schema, or ``schema`` when it holds no ``$ref``.

    Raises:
        KeyError: The reference names a component the document does not define.
    """
    schema_object = _require_mapping(schema, "schema")
    ref = schema_object.get("$ref")
    if not isinstance(ref, str):
        return schema_object
    components = _require_mapping(_document_object(document).get("components"), "components")
    schemas = _require_mapping(components.get("schemas"), "components.schemas")
    return _require_mapping(schemas.get(ref.removeprefix("#/components/schemas/")), "components.schemas[]")


def schema_refs(value: OpenAPIJSON) -> set[str]:
    """Collect every component schema name a document fragment references."""
    refs: set[str] = set()
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            refs.add(ref.removeprefix("#/components/schemas/"))
        for item in value.values():
            refs.update(schema_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.update(schema_refs(item))
    return refs
