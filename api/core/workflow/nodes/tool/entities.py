import re
from collections.abc import Sequence
from typing import Any, Literal, Self, Union

from pydantic import BaseModel, field_validator, model_validator
from pydantic_core.core_schema import ValidationInfo

from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.base.entities import BaseNodeData

# Pattern to match a single variable reference like {{#llm.context#}}
SINGLE_VARIABLE_PATTERN = re.compile(r"^\s*\{\{#[a-zA-Z0-9_]+(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+#\}\}\s*$")


class MentionConfig(BaseModel):
    """Configuration for extracting value from context variable.

    Used when a tool parameter needs to be extracted from list[PromptMessage]
    context using an extractor LLM node.
    """

    # Instruction for the extractor LLM to extract the value
    instruction: str

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
        type: Literal["mixed", "variable", "constant", "mention"]
        # Required config for mention type, extracting value from context variable
        mention_config: MentionConfig | None = None

        @field_validator("type", mode="before")
        @classmethod
        def check_type(cls, value, validation_info: ValidationInfo):
            typ = value
            value = validation_info.data.get("value")

            if value is None:
                return typ

            if typ == "mixed" and not isinstance(value, str):
                raise ValueError("value must be a string")
            elif typ == "mention":
                # Skip here, will be validated in model_validator
                pass
            elif typ == "variable":
                if not isinstance(value, list):
                    raise ValueError("value must be a list")
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError("value must be a list of strings")
            elif typ == "constant" and not isinstance(value, str | int | float | bool | dict):
                raise ValueError("value must be a string, int, float, bool or dict")
            return typ

        @model_validator(mode="after")
        def check_mention_type(self) -> Self:
            """Validate mention type with mention_config."""
            if self.type != "mention":
                return self

            value = self.value
            if value is None:
                return self

            if not isinstance(value, str):
                raise ValueError("value must be a string for mention type")
            # For mention type, value must be a single variable reference
            if not SINGLE_VARIABLE_PATTERN.match(value):
                raise ValueError(
                    "For mention type, value must be a single variable reference "
                    "like {{#node.variable#}}, cannot contain other content"
                )
            # mention_config is required for mention type
            if self.mention_config is None:
                raise ValueError("mention_config is required for mention type")
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
