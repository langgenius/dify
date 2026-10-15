from collections.abc import Mapping
from copy import deepcopy
from typing import Any


def to_strict_json_schema(schema: Mapping[str, Any]) -> dict[str, Any]:
    """Return a copy of a JSON Schema compatible with strict structured output."""
    strict_schema = deepcopy(dict(schema))
    _make_schema_strict(strict_schema)
    return strict_schema


def _make_schema_strict(value: Any) -> None:
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

        for nested_value in value.values():
            _make_schema_strict(nested_value)
    elif isinstance(value, list):
        for nested_value in value:
            _make_schema_strict(nested_value)
