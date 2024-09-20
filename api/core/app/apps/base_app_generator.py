from collections.abc import Mapping
from typing import Any, Optional

from core.app.app_config.entities import AppConfig, VariableEntity, VariableEntityType


class BaseAppGenerator:
    def _get_cleaned_inputs(self, user_inputs: Optional[Mapping[str, Any]], app_config: AppConfig) -> Mapping[str, Any]:
        user_inputs = user_inputs or {}
        # Filter input variables from form configuration, handle required fields, default values, and option values
        variables = app_config.variables
        filtered_inputs = {var.variable: self._validate_input(inputs=user_inputs, var=var) for var in variables}
        filtered_inputs = {k: self._sanitize_value(v) for k, v in filtered_inputs.items()}
        return filtered_inputs

    def _validate_input(self, *, inputs: Mapping[str, Any], var: VariableEntity):
        user_input_value = inputs.get(var.variable)
        if var.required and not user_input_value:
            raise ValueError(f"{var.variable} is required in input form")
        if not var.required and not user_input_value:
            # TODO: should we return None here if the default value is None?
            return var.default or ""
        if (
            var.type
            in {
                VariableEntityType.TEXT_INPUT,
                VariableEntityType.SELECT,
                VariableEntityType.PARAGRAPH,
            }
            and user_input_value
            and not isinstance(user_input_value, str)
        ):
            raise ValueError(f"(type '{var.type}') {var.variable} in input form must be a string")
        if var.type == VariableEntityType.NUMBER and isinstance(user_input_value, str):
            # may raise ValueError if user_input_value is not a valid number
            try:
                if "." in user_input_value:
                    return float(user_input_value)
                else:
                    return int(user_input_value)
            except ValueError:
                raise ValueError(f"{var.variable} in input form must be a valid number")
        if var.type == VariableEntityType.SELECT:
            options = var.options or []
            if user_input_value not in options:
                raise ValueError(f"{var.variable} in input form must be one of the following: {options}")
        elif var.type in {VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH}:
            if var.max_length and user_input_value and len(user_input_value) > var.max_length:
                raise ValueError(f"{var.variable} in input form must be less than {var.max_length} characters")

        return user_input_value

    def _sanitize_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return value.replace("\x00", "")
        return value
