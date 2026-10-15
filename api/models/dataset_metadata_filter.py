"""Dataset metadata filter values and policy, independent of application services.

Retrieval and prompt generation share this domain contract without depending on
service orchestration, ORM state, or infrastructure.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


class MetadataFilterGenerationError(ValueError):
    """Automatic filtering could not produce a safe retrieval condition."""


@dataclass(frozen=True)
class MetadataField:
    """A metadata schema snapshot independent of ORM descriptors."""

    dataset_id: str
    name: str
    type: str


METADATA_OPERATORS: dict[str, tuple[str, ...]] = {
    "string": (
        "contains",
        "not contains",
        "start with",
        "end with",
        "is",
        "is not",
        "empty",
        "not empty",
        "in",
        "not in",
    ),
    "number": ("=", "≠", ">", "<", "≥", "≤", "empty", "not empty"),
    "time": ("is", "before", "after", "empty", "not empty"),
}


def metadata_prompt_fields(fields: Mapping[str, str]) -> list[dict[str, Any]]:
    """Describe the exact shared schema using the validator's operator contract."""
    value_formats = {
        "string": "JSON string; for in/not in, an array of JSON strings",
        "number": "finite JSON number, not a quoted string or boolean",
        "time": "finite JSON number containing a Unix timestamp in seconds",
    }
    schema = []
    for name, kind in fields.items():
        if kind not in METADATA_OPERATORS:
            raise MetadataFilterGenerationError(f"Unsupported metadata field type for {name}")
        schema.append(
            {
                "name": name,
                "type": kind,
                "operators": list(METADATA_OPERATORS[kind]),
                "value_format": value_formats[kind],
            }
        )
    return schema


def shared_metadata_fields(dataset_ids: Sequence[str], fields: Sequence[MetadataField]) -> dict[str, str]:
    schemas: dict[str, dict[str, str]] = {dataset_id: {} for dataset_id in dataset_ids}
    for field in fields:
        if field.dataset_id in schemas:
            schemas[field.dataset_id][field.name] = field.type
    if not schemas:
        return {}
    first, *others = schemas.values()
    return {name: kind for name, kind in first.items() if all(schema.get(name) == kind for schema in others)}


def validate_automatic_metadata_filters(result: Any, fields: Mapping[str, str]) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not isinstance(result.get("metadata_map"), list):
        raise MetadataFilterGenerationError("Automatic metadata filtering requires a metadata_map array")
    conditions = []
    for item in result["metadata_map"]:
        if not isinstance(item, dict):
            raise MetadataFilterGenerationError("Automatic metadata filter must be an object")
        if "metadata_field_value" not in item:
            raise MetadataFilterGenerationError("Automatic metadata filter requires metadata_field_value")
        name = item.get("metadata_field_name")
        if not isinstance(name, str) or name not in fields:
            raise MetadataFilterGenerationError("Automatic metadata field is missing or has conflicting types")
        kind = fields[name]
        operator = item.get("comparison_operator")
        if not isinstance(operator, str) or operator not in METADATA_OPERATORS.get(kind, ()):
            raise MetadataFilterGenerationError(f"Invalid operator for metadata field {name}")
        value = item.get("metadata_field_value")
        if operator in {"empty", "not empty"} and value is not None:
            raise MetadataFilterGenerationError(f"Value must be null for metadata operator {operator}")
        if operator not in {"empty", "not empty"}:
            if kind == "string":
                valid = (
                    isinstance(value, list) and all(isinstance(element, str) for element in value)
                    if operator in {"in", "not in"}
                    else isinstance(value, str)
                )
            else:
                valid = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            if not valid:
                raise MetadataFilterGenerationError(f"Invalid value type for metadata field {name}")
        conditions.append({"metadata_name": name, "value": value, "condition": operator})
    return conditions
