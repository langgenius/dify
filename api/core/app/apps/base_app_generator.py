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

            if variable not in user_inputs or not user_inputs[variable]:
                if variable_config.required:
                    raise ValueError(f"{variable} is required in input form")
                else:
                    filtered_inputs[variable] = variable_config.default if variable_config.default is not None else ""
                    continue

            value = user_inputs[variable]

            if value:
                if not isinstance(value, str):
                    raise ValueError(f"{variable} in input form must be a string")

            if variable_config.type == VariableEntity.Type.SELECT:
                options = variable_config.options if variable_config.options is not None else []
                if value not in options:
                    raise ValueError(f"{variable} in input form must be one of the following: {options}")
            else:
                if variable_config.max_length is not None:
                    max_length = variable_config.max_length
                    if len(value) > max_length:
                        raise ValueError(f'{variable} in input form must be less than {max_length} characters')

            filtered_inputs[variable] = value.replace('\x00', '') if value else None

        return filtered_inputs

