"""Reuse compatible Start values as form defaults, never as execution consent."""

from typing import Any


def reusable_values(schema: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for variable in schema.get("variables", []):
        if not isinstance(variable, dict):
            continue
        name = variable.get("variable")
        if not isinstance(name, str) or name not in values:
            continue
        value = values[name]
        kind = variable.get("type", "text-input")
        if kind in {"text-input", "text", "paragraph", "select"} and not isinstance(value, str):
            continue
        if kind == "number" and (type(value) not in (int, float)):
            continue
        if kind == "checkbox" and not isinstance(value, bool):
            continue
        if value is not None:
            result[name] = value
    return result
