"""Validate Start values and reuse compatible defaults, never grant execution consent."""

from typing import Any

from core.app.apps.base_app_generator import BaseAppGenerator
from graphon.variables.input_entities import VariableEntity


def validate_supplied_values(schema: dict[str, Any], values: dict[str, Any], *, require_all: bool = True) -> None:
    """Validate supplied Start types and declared limits without changing inputs.

    Reuse native value validation only: no upload fetch, file ownership lookup,
    model call, normalization or consent is performed. ``require_all=True``
    additionally checks required fields. Supplied-only validation preserves
    native missing-value routing and allows an initial form to omit them.
    Raise the native input error before assessing or persisting invalid data.
    """
    for variable in schema.get("variables", []):
        if isinstance(variable, dict):
            name = variable.get("variable")
            if isinstance(name, str) and (name in values or (require_all and variable.get("required"))):
                entity = VariableEntity.model_validate(
                    {
                        "label": name,
                        "options": [],
                        "allowed_file_types": [],
                        "allowed_file_extensions": [],
                        "allowed_file_upload_methods": [],
                        **variable,
                        "type": "text-input" if variable.get("type") == "text" else variable.get("type", "text-input"),
                    }
                )
                BaseAppGenerator()._validate_inputs(variable_entity=entity, value=values.get(name))


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
