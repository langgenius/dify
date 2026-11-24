"""Typed access to the OpenAPI documents the API blueprints render.

The renderers hand back plain JSON objects. Walking them as untyped mappings and
re-checking the same keys and value types at every use site spreads one document
shape across every caller, so this module models that shape once and parses a
rendered document once at the boundary: every accessor below takes a shape
defined here and reads it without re-checking it.

The shapes stay open by design: OpenAPI is an extensible format, and the
exporters deliberately keep vendor extensions, so each shape models the keywords
this module reads and admits any other keyword as a JSON value.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from pydantic import TypeAdapter, ValidationError
from typing_extensions import TypedDict

#: One JSON value: a rendered document holds nothing else.
#:
#: The container members are the read-only protocols so the modeled shapes below,
#: which are mappings too, are themselves JSON values and can be handed to the
#: walkers without a conversion.
type OpenAPIJSON = str | int | float | bool | None | Sequence[OpenAPIJSON] | Mapping[str, OpenAPIJSON]

#: The ``$ref`` keyword. Declared functionally because the key is not an
#: identifier; shapes inherit it to keep the OpenAPI spelling.
_RefKeyword = TypedDict("_RefKeyword", {"$ref": str}, total=False)

#: The ``in`` keyword, declared functionally for the same reason.
_InKeyword = TypedDict("_InKeyword", {"in": str}, total=False)


class OpenAPIDiscriminator(TypedDict, total=False, extra_items=OpenAPIJSON):
    """A schema's ``discriminator`` object."""

    propertyName: str
    mapping: dict[str, str]


class OpenAPISchema(_RefKeyword, total=False, extra_items=OpenAPIJSON):
    """One JSON Schema fragment, as the OpenAPI format spells its keywords."""

    type: str
    title: str
    description: str
    format: str
    properties: dict[str, OpenAPISchema]
    required: list[str]
    items: OpenAPISchema
    additionalProperties: OpenAPISchema | bool  # noqa: N815  # OpenAPI wire key.
    anyOf: list[OpenAPISchema]  # noqa: N815  # OpenAPI wire key.
    oneOf: list[OpenAPISchema]  # noqa: N815  # OpenAPI wire key.
    allOf: list[OpenAPISchema]  # noqa: N815  # OpenAPI wire key.
    discriminator: OpenAPIDiscriminator


class OpenAPIMediaType(TypedDict, total=False, extra_items=OpenAPIJSON):
    """One entry of a ``content`` object, keyed by media type."""

    schema: OpenAPISchema


class OpenAPIRequestBody(TypedDict, total=False, extra_items=OpenAPIJSON):
    """An operation's ``requestBody`` object."""

    description: str
    required: bool
    content: dict[str, OpenAPIMediaType]


class OpenAPIResponse(TypedDict, total=False, extra_items=OpenAPIJSON):
    """One entry of an operation's ``responses`` object, keyed by status code."""

    description: str
    content: dict[str, OpenAPIMediaType]


class OpenAPIRawParameter(_InKeyword, total=False, extra_items=OpenAPIJSON):
    """One entry of a ``parameters`` array as rendered.

    Every keyword is optional here: the renderer emits unresolved references as
    entries without a ``name``, which ``parameters_by_name`` skips.
    """

    name: str
    description: str
    required: bool
    schema: OpenAPISchema


class OpenAPIOperation(TypedDict, total=False, extra_items=OpenAPIJSON):
    """One operation object, keyed by ``requestBody``, ``responses``, ..."""

    summary: str
    description: str
    operationId: str
    tags: list[str]
    deprecated: bool
    parameters: list[OpenAPIRawParameter]
    requestBody: OpenAPIRequestBody
    responses: dict[str, OpenAPIResponse]


class OpenAPIRawPathItem(TypedDict, total=False, extra_items=OpenAPIJSON):
    """One ``paths`` entry as rendered.

    Only the operation members are modeled; a path item may also carry shared
    members such as ``parameters``, which stay readable as JSON values.
    """

    summary: str
    description: str
    get: OpenAPIOperation
    put: OpenAPIOperation
    post: OpenAPIOperation
    delete: OpenAPIOperation
    options: OpenAPIOperation
    head: OpenAPIOperation
    patch: OpenAPIOperation
    trace: OpenAPIOperation


class OpenAPIComponents(TypedDict, total=False, extra_items=OpenAPIJSON):
    """A document's ``components`` object."""

    schemas: dict[str, OpenAPISchema]


class OpenAPIRawDocument(TypedDict, total=False, extra_items=OpenAPIJSON):
    """The top level of a rendered document."""

    openapi: str
    info: Mapping[str, OpenAPIJSON]
    paths: dict[str, OpenAPIRawPathItem]
    components: OpenAPIComponents


#: One entry of an operation's ``parameters`` array, with every keyword resolved.
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

#: One ``paths`` entry after parsing, keyed by lower-case HTTP method.
type OpenAPIPathItem = dict[str, OpenAPIOperation]

_RAW_DOCUMENT_ADAPTER: Final[TypeAdapter[OpenAPIRawDocument]] = TypeAdapter(OpenAPIRawDocument)

#: The operation members of a path item, read by literal key so each read keeps
#: the operation type instead of the open-ended JSON value type.
_OPERATION_MEMBERS: Final[dict[str, Callable[[OpenAPIRawPathItem], OpenAPIOperation | None]]] = {
    "get": lambda item: item.get("get"),
    "put": lambda item: item.get("put"),
    "post": lambda item: item.get("post"),
    "delete": lambda item: item.get("delete"),
    "options": lambda item: item.get("options"),
    "head": lambda item: item.get("head"),
    "patch": lambda item: item.get("patch"),
    "trace": lambda item: item.get("trace"),
}

#: What each pydantic error type says a value should have been.
_EXPECTED_KINDS: Final[dict[str, str]] = {
    "dict_type": "an object",
    "list_type": "an array",
    "string_type": "a string",
    "bool_type": "a boolean",
    "int_type": "an integer",
    "float_type": "a number",
}

#: Keywords whose value is a map keyed by names the format leaves open, so the
#: next location step is a name in brackets rather than a nested keyword.
_OPEN_MAPS: Final[frozenset[str]] = frozenset({"paths", "schemas", "securitySchemes", "responses", "content"})


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


def _location(steps: Sequence[str | int]) -> str:
    """Spell a validation location the way the document is read.

    Keywords join with dots; a name inside an open-ended map such as ``paths``
    or ``components.schemas`` is bracketed, and a list index keeps its brackets.
    """
    parts: list[str] = []
    previous = ""
    for step in steps:
        if isinstance(step, int):
            parts[-1] = f"{parts[-1]}[{step}]"
        elif previous in _OPEN_MAPS:
            parts.append(f"[{step}]")
        else:
            parts.append(str(step))
        previous = str(step)
    return "".join(part if index == 0 or part.startswith("[") else f".{part}" for index, part in enumerate(parts))


def _structure_error(error: ValidationError) -> OpenAPIStructureError:
    """Name the first shape violation the boundary found, in document terms.

    Args:
        error: The validation failure of one rendered document.

    Returns:
        The failure as an ``OpenAPIStructureError`` naming the offending location.
    """
    first = error.errors()[0]
    location = _location(first["loc"]) or "document"
    kind = _EXPECTED_KINDS.get(first["type"], "a JSON value")
    return OpenAPIStructureError(f"expected {location} to be {kind}, got {type(first['input']).__name__}")


def _path_item_operations(item: OpenAPIRawPathItem) -> OpenAPIPathItem:
    """Return the operations a path item declares.

    Non-operation members such as a shared ``parameters`` array are not
    operations and are left out of the returned view.
    """
    operations: OpenAPIPathItem = {}
    for method, read in _OPERATION_MEMBERS.items():
        operation = read(item)
        if operation is not None:
            operations[method] = operation
    return operations


def parse_openapi_document(raw: OpenAPIJSON) -> OpenAPIDocument:
    """Parse a document decoded from the exported or served OpenAPI JSON.

    Args:
        raw: The result of ``json.loads`` on a rendered document.

    Returns:
        The parsed document, whose shapes every accessor below reads directly.

    Raises:
        OpenAPIStructureError: ``raw`` is not a document, or a modeled keyword
            holds a value of the wrong JSON type.
    """
    try:
        document = _RAW_DOCUMENT_ADAPTER.validate_python(raw)
    except ValidationError as error:
        raise _structure_error(error) from error

    paths = {path: _path_item_operations(item) for path, item in document.get("paths", {}).items()}
    schemas = document.get("components", OpenAPIComponents()).get("schemas", {})
    return OpenAPIDocument(raw=document, paths=paths, schemas=schemas)


def operation_at(document: OpenAPIDocument, path: str, method: str) -> OpenAPIOperation:
    """Return the operation object at ``path`` and ``method``.

    Raises:
        KeyError: The document has no such path or method.
    """
    return document.paths[path][method]


def lookup(value: OpenAPIJSON, *path: str | int, default: OpenAPIJSON = None) -> OpenAPIJSON:
    """Follow ``path`` through a document value and return what it names.

    Use this for the one-off assertions on keywords the shapes do not model;
    the accessors below name the shapes callers read repeatedly.

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
            if not isinstance(current, Sequence) or isinstance(current, str):
                raise OpenAPIStructureError(f"expected a list before index {step}, got {type(current).__name__}")
            current = current[step]
        else:
            if not isinstance(current, Mapping):
                raise OpenAPIStructureError(f"expected an object before key {step!r}, got {type(current).__name__}")
            if step not in current:
                return default
            current = current[step]
    return current


def object_at(value: OpenAPIJSON, *path: str) -> Mapping[str, OpenAPIJSON]:
    """Return the object ``path`` names, so callers need no runtime assert.

    Raises:
        OpenAPIStructureError: A step is missing or names a non-object.
    """
    named = lookup(value, *path)
    if not isinstance(named, Mapping):
        raise OpenAPIStructureError(f"expected {'.'.join(path)} to be an object, got {type(named).__name__}")
    return named


def array_at(value: OpenAPIJSON, *path: str) -> Sequence[OpenAPIJSON]:
    """Return the array ``path`` names.

    Raises:
        OpenAPIStructureError: A step is missing or names a non-array.
    """
    named = lookup(value, *path)
    if not isinstance(named, Sequence) or isinstance(named, str):
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


def _paths_of(document: OpenAPIDocument | OpenAPIRawDocument) -> dict[str, OpenAPIPathItem]:
    """Return the document's operations, keyed by path and method.

    Accepts the parsed document or a raw document mapping, which is parsed here
    so callers holding either one read the same typed view.
    """
    if isinstance(document, OpenAPIDocument):
        return document.paths
    return parse_openapi_document(document).paths


def all_operations(document: OpenAPIDocument | OpenAPIRawDocument) -> list[tuple[str, str, OpenAPIOperation]]:
    """Return every declared operation as a ``(path, method, operation)`` triple."""
    return [
        (path, method, operation) for path, item in _paths_of(document).items() for method, operation in item.items()
    ]


def operations_of(document: OpenAPIDocument | OpenAPIRawDocument) -> list[tuple[str, OpenAPIOperation]]:
    """Return every ``GET`` operation as a ``(path, operation)`` pair."""
    return [(path, item["get"]) for path, item in _paths_of(document).items() if "get" in item]


def request_body_schema(operation: OpenAPIOperation, media_type: str) -> OpenAPISchema:
    """Return the schema a request body declares for ``media_type``.

    Args:
        operation: A parsed operation object.
        media_type: The exact media type, e.g. ``application/json``.

    Raises:
        KeyError: The operation declares no request body, or none for that media
            type, or that media type declares no schema.
    """
    return operation["requestBody"]["content"][media_type]["schema"]


def response_content_types(operation: OpenAPIOperation, status_code: str = "200") -> set[str]:
    """Return the media types a response declares.

    Raises:
        KeyError: The operation declares no such response or no content for it.
    """
    return set(operation["responses"][status_code]["content"])


def response_schema(
    operation: OpenAPIOperation, status_code: str = "200", media_type: str = "application/json"
) -> OpenAPISchema:
    """Return the schema a response declares for ``media_type``.

    Raises:
        KeyError: The operation declares no such response schema.
    """
    return operation["responses"][status_code]["content"][media_type]["schema"]


def parameters_by_name(operation: OpenAPIOperation) -> dict[str, OpenAPIParameter]:
    """Index an operation's parameters by name.

    Parameters without a ``name`` are skipped, which is how the renderer emits
    unresolved references.
    """
    indexed: dict[str, OpenAPIParameter] = {}
    for parameter in operation.get("parameters", []):
        name = parameter.get("name")
        if name is not None:
            indexed[name] = OpenAPIParameter(
                name=name,
                description=parameter.get("description", ""),
                required=parameter.get("required", False),
                schema=parameter.get("schema", OpenAPISchema()),
                **{"in": parameter.get("in", "")},
            )
    return indexed


def properties_of(schema: OpenAPISchema) -> dict[str, OpenAPISchema]:
    """Return a schema's ``properties`` map, empty when it declares none."""
    return schema.get("properties", {})


def required_of(schema: OpenAPISchema) -> list[str]:
    """Return a schema's ``required`` names, empty when it declares none."""
    return schema.get("required", [])


def variants_of(schema: OpenAPISchema, field: str = "anyOf") -> list[OpenAPISchema]:
    """Return the alternative schemas a schema lists under ``field``.

    Args:
        schema: A parsed schema.
        field: One of ``anyOf``, ``oneOf`` or ``allOf``; any other name lists no
            alternatives.
    """
    if field == "oneOf":
        return schema.get("oneOf", [])
    if field == "allOf":
        return schema.get("allOf", [])
    return schema.get("anyOf", [])


def _schemas_of(document: OpenAPIDocument | OpenAPIRawDocument) -> dict[str, OpenAPISchema]:
    """Return the component schemas, parsing a raw document when given one."""
    if isinstance(document, OpenAPIDocument):
        return document.schemas
    return parse_openapi_document(document).schemas


def resolve_schema(document: OpenAPIDocument | OpenAPIRawDocument, schema: OpenAPISchema) -> OpenAPISchema:
    """Resolve a schema that may be a ``$ref`` into its component schema.

    Returns:
        The referenced component schema, or ``schema`` when it holds no ``$ref``.

    Raises:
        KeyError: The reference names a component the document does not define.
    """
    ref = schema.get("$ref")
    if ref is None:
        return schema
    return _schemas_of(document)[ref.removeprefix("#/components/schemas/")]


def schema_refs(value: OpenAPIJSON) -> set[str]:
    """Collect every component schema name a document fragment references."""
    refs: set[str] = set()
    if isinstance(value, Mapping):
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            refs.add(ref.removeprefix("#/components/schemas/"))
        for item in value.values():
            refs.update(schema_refs(item))
    elif isinstance(value, Sequence) and not isinstance(value, str):
        for item in value:
            refs.update(schema_refs(item))
    return refs
