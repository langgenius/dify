import re

from core.app.app_config.entities import ExternalDataVariableEntity, VariableEntity, VariableEntityType
from core.external_data_tool.factory import ExternalDataToolFactory


class BasicVariablesConfigManager:
    @classmethod
    def convert(cls, config: dict) -> tuple[list[VariableEntity], list[ExternalDataVariableEntity]]:
        """
        Convert model config to model config

        :param config: model config args
        """
        external_data_variables = []
        variable_entities = []

        # old external_data_tools
        external_data_tools = config.get("external_data_tools", [])
        for external_data_tool in external_data_tools:
            if "enabled" not in external_data_tool or not external_data_tool["enabled"]:
                continue

            external_data_variables.append(
                ExternalDataVariableEntity(
                    variable=external_data_tool["variable"],
                    type=external_data_tool["type"],
                    config=external_data_tool["config"],
                )
            )

        # variables and external_data_tools
        for variables in config.get("user_input_form", []):
            variable_type = list(variables.keys())[0]
            if variable_type == VariableEntityType.EXTERNAL_DATA_TOOL:
                variable = variables[variable_type]
                if "config" not in variable:
                    continue

                external_data_variables.append(
                    ExternalDataVariableEntity(
                        variable=variable["variable"], type=variable["type"], config=variable["config"]
                    )
                )
            elif variable_type in {
                VariableEntityType.TEXT_INPUT,
                VariableEntityType.PARAGRAPH,
                VariableEntityType.NUMBER,
                VariableEntityType.SELECT,
            }:
                variable = variables[variable_type]
                variable_entities.append(
                    VariableEntity(
                        type=variable_type,
                        variable=variable.get("variable"),
                        description=variable.get("description", ""),
                        label=variable.get("label"),
                        required=variable.get("required", False),
                        max_length=variable.get("max_length"),
                        options=variable.get("options", []),
                    )
                )

        return variable_entities, external_data_variables

    @classmethod
    def validate_and_set_defaults(cls, tenant_id: str, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for user input form

        :param tenant_id: workspace id
        :param config: app model config args
        """
        related_config_keys = []
        config, current_related_config_keys = cls.validate_variables_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        config, current_related_config_keys = cls.validate_external_data_tools_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        return config, related_config_keys

    @classmethod
    def validate_variables_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for user input form

        :param config: app model config args
        """
        if not config.get("user_input_form"):
            config["user_input_form"] = []

        if not isinstance(config["user_input_form"], list):
            raise ValueError("user_input_form must be a list of objects")

        variables = []
        for item in config["user_input_form"]:
            key = list(item.keys())[0]
            if key not in {"text-input", "select", "paragraph", "number", "external_data_tool"}:
                raise ValueError("Keys in user_input_form list can only be 'text-input', 'paragraph'  or 'select'")

            form_item = item[key]
            if "label" not in form_item:
                raise ValueError("label is required in user_input_form")

            if not isinstance(form_item["label"], str):
                raise ValueError("label in user_input_form must be of string type")

            if "variable" not in form_item:
                raise ValueError("variable is required in user_input_form")

            if not isinstance(form_item["variable"], str):
                raise ValueError("variable in user_input_form must be of string type")

            pattern = re.compile(r"^(?!\d)[\u4e00-\u9fa5A-Za-z0-9_\U0001F300-\U0001F64F\U0001F680-\U0001F6FF]{1,100}$")
            if pattern.match(form_item["variable"]) is None:
                raise ValueError("variable in user_input_form must be a string, and cannot start with a number")

            variables.append(form_item["variable"])

            if "required" not in form_item or not form_item["required"]:
                form_item["required"] = False

            if not isinstance(form_item["required"], bool):
                raise ValueError("required in user_input_form must be of boolean type")

            if key == "select":
                if "options" not in form_item or not form_item["options"]:
                    form_item["options"] = []

                if not isinstance(form_item["options"], list):
                    raise ValueError("options in user_input_form must be a list of strings")

                if "default" in form_item and form_item["default"] and form_item["default"] not in form_item["options"]:
                    raise ValueError("default value in user_input_form must be in the options list")

        return config, ["user_input_form"]

    @classmethod
    def validate_external_data_tools_and_set_defaults(cls, tenant_id: str, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for external data fetch feature

        :param tenant_id: workspace id
        :param config: app model config args
        """
        if not config.get("external_data_tools"):
            config["external_data_tools"] = []

        if not isinstance(config["external_data_tools"], list):
            raise ValueError("external_data_tools must be of list type")

        for tool in config["external_data_tools"]:
            if "enabled" not in tool or not tool["enabled"]:
                tool["enabled"] = False

            if not tool["enabled"]:
                continue

            if "type" not in tool or not tool["type"]:
                raise ValueError("external_data_tools[].type is required")

            typ = tool["type"]
            config = tool["config"]

            ExternalDataToolFactory.validate_config(name=typ, tenant_id=tenant_id, config=config)

        return config, ["external_data_tools"]
