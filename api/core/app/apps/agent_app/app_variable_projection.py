from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from models.agent_config_entities import AppVariableConfig


def agent_app_variables_to_user_input_form(app_variables: Sequence[AppVariableConfig]) -> list[dict[str, Any]]:
    """Project Agent Soul app variables into the legacy service-API parameter form."""

    user_input_form: list[dict[str, Any]] = []
    for variable in app_variables:
        form_type = _form_type_for_agent_variable(variable.type)
        form_item: dict[str, Any] = {
            "label": variable.name,
            "variable": variable.name,
            "required": variable.required,
        }
        if variable.default is not None:
            form_item["default"] = variable.default
        user_input_form.append({form_type: form_item})
    return user_input_form


def _form_type_for_agent_variable(variable_type: str) -> str:
    normalized = variable_type.strip().lower()
    if normalized in {"number", "integer", "float"}:
        return "number"
    if normalized in {"boolean", "bool"}:
        return "checkbox"
    if normalized in {"paragraph", "long_text", "multiline"}:
        return "paragraph"
    return "text-input"


__all__ = ["agent_app_variables_to_user_input_form"]
