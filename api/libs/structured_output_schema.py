from collections.abc import Mapping
from copy import deepcopy
from typing import Any


def to_strict_json_schema(schema: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize schema nodes for strict output without changing literal values.

    Preconditions: ``schema`` is a JSON Schema mapping.
    Postconditions: object schemas require their properties and reject extras;
    schema-level null defaults are removed. Literal values and the input mapping
    remain unchanged. There is no I/O.
    """
    strict_schema = deepcopy(dict(schema))
    _make_schema_strict(strict_schema)
    return strict_schema


def _make_schema_strict(value: Any) -> None:
    """Normalize a schema or schema list in place, leaving instance data intact."""
    if isinstance(value, dict):
        properties = value.get("properties")
        if value.get("type") == "object":
            value["additionalProperties"] = False
            if isinstance(properties, dict):
                # Strict structured output requires every property to be present.
                # Logically optional fields remain nullable in their type schema.
                value["required"] = list(properties)

        # A nullable type already represents the optional value. Removing the
        # Pydantic default keeps the schema within strict-provider subsets.
        if "default" in value and value["default"] is None:
            del value["default"]

        # Names inside these maps are property/definition names, not keywords.
        # A property named "default" still contains a schema to normalize.
        for keyword in ("$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies"):
            schemas = value.get(keyword)
            if isinstance(schemas, dict):
                for nested_schema in schemas.values():
                    _make_schema_strict(nested_schema)

        # Only these keyword values contain child schemas. In particular,
        # const/enum/default/examples contain instance values, even when those
        # objects happen to have keys such as "type", "properties" or "default".
        for keyword in (
            "allOf",
            "anyOf",
            "oneOf",
            "prefixItems",
            "items",
            "additionalItems",
            "contains",
            "additionalProperties",
            "unevaluatedProperties",
            "unevaluatedItems",
            "propertyNames",
            "not",
            "if",
            "then",
            "else",
            "contentSchema",
        ):
            _make_schema_strict(value.get(keyword))
    elif isinstance(value, list):
        for nested_value in value:
            _make_schema_strict(nested_value)
