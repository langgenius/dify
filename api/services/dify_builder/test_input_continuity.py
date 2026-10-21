"""Reuse compatible Start values as form defaults, never as execution consent."""

from typing import Any

from core.app.apps.base_app_generator import BaseAppGenerator
from graphon.variables.input_entities import VariableEntity


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
        if kind not in {
            "text-input",
            "text",
            "paragraph",
            "select",
            "number",
            "checkbox",
            "file",
            "file-list",
            "json_object",
        }:
            continue
        if kind in {"text-input", "text", "paragraph", "select"} and not isinstance(value, str):
            continue
        if kind == "number" and (type(value) not in (int, float)):
            continue
        if kind == "checkbox" and not isinstance(value, bool):
            continue
        if value is None:
            continue
        try:
            entity = VariableEntity.model_validate(
                {
                    "label": name,
                    "options": [],
                    "allowed_file_types": [],
                    "allowed_file_extensions": [],
                    "allowed_file_upload_methods": [],
                    **variable,
                    "type": "text-input" if kind == "text" else kind,
                }
            )
            # Reuse native value validation only. File ownership/resolution and
            # execution consent remain with native input preparation.
            BaseAppGenerator()._validate_inputs(variable_entity=entity, value=value)
        except (ValueError, TypeError):
            continue
        result[name] = value
    return result
