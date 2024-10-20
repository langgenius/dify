from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Optional

from core.app.app_config.entities import VariableEntityType
from core.file import File, FileExtraConfig
from factories import file_factory

if TYPE_CHECKING:
    from core.app.app_config.entities import AppConfig, VariableEntity
    from models.enums import CreatedByRole


class BaseAppGenerator:
    def _prepare_user_inputs(
        self,
        *,
        user_inputs: Optional[Mapping[str, Any]],
        app_config: "AppConfig",
        user_id: str,
        role: "CreatedByRole",
    ) -> Mapping[str, Any]:
        user_inputs = user_inputs or {}
        # Filter input variables from form configuration, handle required fields, default values, and option values
        variables = app_config.variables
        user_inputs = {var.variable: self._validate_input(inputs=user_inputs, var=var) for var in variables}
        user_inputs = {k: self._sanitize_value(v) for k, v in user_inputs.items()}
        # Convert files in inputs to File
        entity_dictionary = {item.variable: item for item in app_config.variables}
        # Convert single file to File
        files_inputs = {
            k: file_factory.build_from_mapping(
                mapping=v,
                tenant_id=app_config.tenant_id,
                user_id=user_id,
                role=role,
                config=FileExtraConfig(
                    allowed_file_types=entity_dictionary[k].allowed_file_types,
                    allowed_extensions=entity_dictionary[k].allowed_file_extensions,
                    allowed_upload_methods=entity_dictionary[k].allowed_file_upload_methods,
                ),
            )
            for k, v in user_inputs.items()
            if isinstance(v, dict) and entity_dictionary[k].type == VariableEntityType.FILE
        }
        # Convert list of files to File
        file_list_inputs = {
            k: file_factory.build_from_mappings(
                mappings=v,
                tenant_id=app_config.tenant_id,
                user_id=user_id,
                role=role,
                config=FileExtraConfig(
                    allowed_file_types=entity_dictionary[k].allowed_file_types,
                    allowed_extensions=entity_dictionary[k].allowed_file_extensions,
                    allowed_upload_methods=entity_dictionary[k].allowed_file_upload_methods,
                ),
            )
            for k, v in user_inputs.items()
            if isinstance(v, list)
            # Ensure skip List<File>
            and all(isinstance(item, dict) for item in v)
            and entity_dictionary[k].type == VariableEntityType.FILE_LIST
        }
        # Merge all inputs
        user_inputs = {**user_inputs, **files_inputs, **file_list_inputs}

        # Check if all files are converted to File
        if any(filter(lambda v: isinstance(v, dict), user_inputs.values())):
            raise ValueError("Invalid input type")
        if any(
            filter(lambda v: isinstance(v, dict), filter(lambda item: isinstance(item, list), user_inputs.values()))
        ):
            raise ValueError("Invalid input type")

        return user_inputs

    def _validate_input(self, *, inputs: Mapping[str, Any], var: "VariableEntity"):
        user_input_value = inputs.get(var.variable)
        if not user_input_value:
            if var.required:
                raise ValueError(f"{var.variable} is required in input form")
            else:
                return None

        if var.type in {
            VariableEntityType.TEXT_INPUT,
            VariableEntityType.SELECT,
            VariableEntityType.PARAGRAPH,
        } and not isinstance(user_input_value, str):
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
            options = var.options
            if user_input_value not in options:
                raise ValueError(f"{var.variable} in input form must be one of the following: {options}")
        elif var.type in {VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH}:
            if var.max_length and len(user_input_value) > var.max_length:
                raise ValueError(f"{var.variable} in input form must be less than {var.max_length} characters")
        elif var.type == VariableEntityType.FILE:
            if not isinstance(user_input_value, dict) and not isinstance(user_input_value, File):
                raise ValueError(f"{var.variable} in input form must be a file")
        elif var.type == VariableEntityType.FILE_LIST:
            if not (
                isinstance(user_input_value, list)
                and (
                    all(isinstance(item, dict) for item in user_input_value)
                    or all(isinstance(item, File) for item in user_input_value)
                )
            ):
                raise ValueError(f"{var.variable} in input form must be a list of files")

        return user_input_value

    def _sanitize_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return value.replace("\x00", "")
        return value
