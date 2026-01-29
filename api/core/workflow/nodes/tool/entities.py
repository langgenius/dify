import re
from collections.abc import Sequence
from typing import Any, Literal, Self, Union

from pydantic import BaseModel, field_validator, model_validator
from pydantic_core.core_schema import ValidationInfo

from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.base.entities import BaseNodeData

# Pattern to match mention format: {{@node.context@}}instruction
MENTION_VALUE_PATTERN = re.compile(r"^\{\{@([a-zA-Z0-9_]+)\.context@\}\}(.*)$", re.DOTALL)

# Pattern to match variable format: {{#node_id.variable#}}
VARIABLE_VALUE_PATTERN = re.compile(r"^\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}$")


def is_variable_format(value: str) -> bool:
    """Check if value is variable format {{#node_id.variable#}}."""
    return VARIABLE_VALUE_PATTERN.match(value) is not None


class NestedNodeConfig(BaseModel):
    """Configuration for extracting value from context variable.

    Used when a tool parameter needs to be extracted from list[PromptMessage]
    context using an extractor LLM node.

    Note: instruction is embedded in the value field as "{{@node.context@}}instruction"
    """

    # ID of the extractor LLM node
    extractor_node_id: str

    # Output variable selector from extractor node
    # e.g., ["text"], ["structured_output", "query"]
    output_selector: Sequence[str]

    # Strategy when output is None
    null_strategy: Literal["raise_error", "use_default"] = "raise_error"

    # Default value when null_strategy is "use_default"
    # Type should match the parameter's expected type
    default_value: Any = None


class ToolEntity(BaseModel):
    provider_id: str
    provider_type: ToolProviderType
    provider_name: str  # redundancy
    tool_name: str
    tool_label: str  # redundancy
    tool_configurations: dict[str, Any]
    credential_id: str | None = None
    plugin_unique_identifier: str | None = None  # redundancy

    @field_validator("tool_configurations", mode="before")
    @classmethod
    def validate_tool_configurations(cls, value, values: ValidationInfo):
        if not isinstance(value, dict):
            raise ValueError("tool_configurations must be a dictionary")

        for key in values.data.get("tool_configurations", {}):
            value = values.data.get("tool_configurations", {}).get(key)
            if not isinstance(value, str | int | float | bool):
                raise ValueError(f"{key} must be a string")

        return value


class ToolNodeData(BaseNodeData, ToolEntity):
    class ToolInput(BaseModel):
        # TODO: check this type
        value: Union[Any, list[str]]
        type: Literal["mixed", "variable", "constant", "nested_node"]
        # Required config for nested_node type, extracting value from context variable
        nested_node_config: NestedNodeConfig | None = None

        @field_validator("type", mode="before")
        @classmethod
        def check_type(cls, value, validation_info: ValidationInfo):
            typ = value
            value = validation_info.data.get("value")

            if value is None:
                return typ

            if typ == "mixed" and not isinstance(value, str):
                raise ValueError("value must be a string")
            elif typ == "nested_node":
                # Skip here, will be validated in model_validator
                pass
            elif typ == "variable":
                if not isinstance(value, list):
                    raise ValueError("value must be a list")
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError("value must be a list of strings")
            elif typ == "constant" and not isinstance(value, (allowed_types := (str, int, float, bool, dict, list))):
                raise ValueError(f"value must be one of: {', '.join(t.__name__ for t in allowed_types)}")
            return typ

        @model_validator(mode="after")
        def check_nested_node_type(self) -> Self:
            """Validate nested_node type with nested_node_config."""
            if self.type != "nested_node":
                return self

            value = self.value
            if value is None:
                return self

            if not isinstance(value, str):
                raise ValueError("value must be a string for nested_node type")
            if self.nested_node_config is None:
                raise ValueError("nested_node_config is required for nested_node type")
            # Validate format: must be variable {{#...#}} or mention {{@...@}}
            if not is_variable_format(value) and not MENTION_VALUE_PATTERN.match(value):
                raise ValueError("value must be variable format {{#node.var#}} or mention format {{@node.context@}}")
            return self

    tool_parameters: dict[str, ToolInput]
    # The version of the tool parameter.
    # If this value is None, it indicates this is a previous version
    # and requires using the legacy parameter parsing rules.
    tool_node_version: str | None = None

    @field_validator("tool_parameters", mode="before")
    @classmethod
    def filter_none_tool_inputs(cls, value):
        if not isinstance(value, dict):
            return value

        return {
            key: tool_input
            for key, tool_input in value.items()
            if tool_input is not None and cls._has_valid_value(tool_input)
        }

    @staticmethod
    def _has_valid_value(tool_input):
        """Check if the value is valid"""
        if isinstance(tool_input, dict):
            return tool_input.get("value") is not None
        return getattr(tool_input, "value", None) is not None
