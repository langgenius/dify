"""Build the ``browse_web`` result model from a JSON Schema.

The API layer carries the schema as plain JSON; the browser layer turns it
into the Pydantic model class the harness ``output_schema`` field expects.
Only the declarative subset of JSON Schema is accepted -- enough for typed
extraction ("return the title and price") -- while structural composition
($ref, anyOf, ...) is rejected with a precise error instead of a silent
approximation.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

__all__ = ["OutputSchemaError", "build_output_model"]

_MAX_DEPTH = 8
_ANNOTATION_KEYS = frozenset(
    {
        "$comment",
        "default",
        "description",
        "examples",
        "example",
        "format",
        "maxLength",
        "maxItems",
        "maximum",
        "minLength",
        "minItems",
        "minimum",
        "readOnly",
        "title",
        "writeOnly",
    }
)
_PRIMITIVE_TYPES = {
    "boolean": bool,
    "integer": int,
    "number": float,
    "string": str,
}
_IDENTIFIER_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_")
_IDENTIFIER_BODY = _IDENTIFIER_START | set("0123456789")


class OutputSchemaError(ValueError):
    """The configured output schema is outside the supported subset."""


def _fail(path: str, detail: str) -> None:
    raise OutputSchemaError(f"output schema at '{path or '<top>'}': {detail}")


def _check_keys(prop_path: str, prop: dict[str, Any], allowed: frozenset[str]) -> None:
    for key in sorted(set(prop) - allowed - _ANNOTATION_KEYS - {"type"}):
        _fail(prop_path, f"'{key}' is not supported")


def _enum_type(prop_path: str, values: Any) -> Any:
    if not isinstance(values, list) or not values:
        _fail(prop_path, "'enum' must be a non-empty list")
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            _fail(prop_path, "every 'enum' value must be a string, number, or boolean")
        if isinstance(value, float) and value != int(value):
            _fail(prop_path, "numeric 'enum' values must be whole numbers for Literal")
    return Literal[tuple(values)]  # type: ignore[valid-type]


def _field_type(prop_path: str, prop: dict[str, Any], *, depth: int) -> Any:
    if depth > _MAX_DEPTH:
        _fail(prop_path, "schema nesting is too deep")
    value_type = prop.get("type")
    if value_type is None:
        if "enum" in prop:
            return _enum_type(prop_path, prop["enum"])
        if "properties" in prop:
            value_type = "object"
        else:
            _check_keys(prop_path, prop, frozenset({"enum"}))
            return Any
    if isinstance(value_type, list):
        _fail(prop_path, "a list of 'type' values is not supported")
    if value_type in _PRIMITIVE_TYPES:
        _check_keys(prop_path, prop, frozenset({"enum"}))
        if "enum" in prop:
            return _enum_type(prop_path, prop["enum"])
        return _PRIMITIVE_TYPES[value_type]
    if value_type == "object":
        _check_keys(prop_path, prop, frozenset({"properties", "required", "additionalProperties"}))
        model_name = f"{prop_path.rstrip('/').replace('/', '_') or 'Nested'}Item"
        return _build_model(model_name, prop, model_path=prop_path, depth=depth)
    if value_type == "array":
        _check_keys(prop_path, prop, frozenset({"items"}))
        items = prop.get("items", {"type": "string"})
        if isinstance(items, list):
            _fail(f"{prop_path}/items", "tuple-form 'items' is not supported")
        return list[_field_type(f"{prop_path}/items", items, depth=depth + 1)]
    _fail(prop_path, f"unsupported type {value_type!r}")


def _build_model(
    name: str,
    schema: dict[str, Any],
    *,
    model_path: str,
    depth: int,
) -> type[BaseModel]:
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict):
        _fail(model_path, "'properties' must be an object")
    if not isinstance(required, list):
        _fail(f"{model_path}/required", "'required' must be a list")
    required_set: set[str] = set()
    for entry in required:
        if not isinstance(entry, str) or entry not in properties:
            _fail(f"{model_path}/required", f"'{entry!r}' is not a declared property")
        required_set.add(entry)
    fields: dict[str, Any] = {}
    for prop_name, prop in properties.items():
        if not isinstance(prop, dict):
            _fail(f"{model_path}/{prop_name}", "each property schema must be an object")
        if not _is_identifier(prop_name):
            _fail(f"{model_path}/{prop_name}", "property names must be Python identifiers")
        fields[prop_name] = _field_spec(f"{model_path}/{prop_name}", prop, prop_name in required_set, depth=depth + 1)
    return create_model(name, __config__=ConfigDict(extra="forbid"), **fields)  # type: ignore[arg-type]


def _field_spec(
    prop_path: str,
    prop: dict[str, Any],
    required: bool,
    *,
    depth: int,
) -> tuple[Any, Any]:
    python_type = _field_type(prop_path, prop, depth=depth)
    description = prop.get("description")
    if required:
        return (python_type, Field(..., description=description) if description else (...))
    default = prop.get("default")
    if default is None:
        python_type = python_type | None
        return (python_type, Field(default=None, description=description) if description else (None))
    if description:
        return (python_type, Field(default, description=description))
    return (python_type, Field(default))


def _is_identifier(name: str) -> bool:
    if not name or name[0] not in _IDENTIFIER_START:
        return False
    return all(char in _IDENTIFIER_BODY for char in name[1:])


def build_output_model(schema: Any, name: str = "BrowseWebResult") -> type[BaseModel]:
    """Compile the top-level JSON Schema object into a Pydantic model class."""
    if not isinstance(schema, dict):
        raise OutputSchemaError("output schema must be a JSON object")
    value_type = schema.get("type", "object")
    if value_type is None:
        value_type = "object"
    if value_type != "object" or "properties" not in schema:
        raise OutputSchemaError("output schema must describe a JSON object with 'properties'")
    for key in sorted(set(schema) - {"type", "properties", "required"}):
        if key not in _ANNOTATION_KEYS:
            _fail("<top>", f"'{key}' is not supported")
    return _build_model(name, schema, model_path="<top>", depth=0)
