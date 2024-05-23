from core.app.app_config.entities import AppConfig, VariableEntity


class BaseAppGenerator:
    def _get_cleaned_inputs(self, user_inputs: dict, app_config: AppConfig):
        if user_inputs is None:
            user_inputs = {}

        filtered_inputs = {}

        # Filter input variables from form configuration, handle required fields, default values, and option values
        variables = app_config.variables
        for variable_config in variables:
            variable = variable_config.variable

            if (variable not in user_inputs
                    or user_inputs[variable] is None
                    or (isinstance(user_inputs[variable], str) and user_inputs[variable] == '')):
                if variable_config.required:
                    raise ValueError(f"{variable} is required in input form")
                else:
                    filtered_inputs[variable] = variable_config.default if variable_config.default is not None else ""
                    continue

            value = user_inputs[variable]

            if value is not None:
                if variable_config.type != VariableEntity.Type.NUMBER and not isinstance(value, str):
                    raise ValueError(f"{variable} in input form must be a string")
                elif variable_config.type == VariableEntity.Type.NUMBER and isinstance(value, str):
                    if '.' in value:
                        value = float(value)
                    else:
                        value = int(value)

            if variable_config.type == VariableEntity.Type.SELECT:
                options = variable_config.options if variable_config.options is not None else []
                if value not in options:
                    raise ValueError(f"{variable} in input form must be one of the following: {options}")
            elif variable_config.type in [VariableEntity.Type.TEXT_INPUT, VariableEntity.Type.PARAGRAPH]:
                if variable_config.max_length is not None:
                    max_length = variable_config.max_length
                    if len(value) > max_length:
                        raise ValueError(f'{variable} in input form must be less than {max_length} characters')

            if value and isinstance(value, str):
                filtered_inputs[variable] = value.replace('\x00', '')
            else:
                filtered_inputs[variable] = value if value is not None else None

        return filtered_inputs

