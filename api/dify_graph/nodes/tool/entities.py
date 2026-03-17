from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel, TypeAdapter, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.tools.entities.tool_entities import ToolProviderType
from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType

ToolConfigurationValue: TypeAlias = str | int | float | bool
ToolConfigurations: TypeAlias = dict[str, ToolConfigurationValue]
ToolInputConstantValue: TypeAlias = str | int | float | bool | dict[str, object] | list[object] | None
VariableSelector: TypeAlias = list[str]

_TOOL_CONFIGURATIONS_ADAPTER: TypeAdapter[ToolConfigurations] = TypeAdapter(ToolConfigurations)
_TOOL_INPUT_MIXED_ADAPTER: TypeAdapter[str] = TypeAdapter(str)
_TOOL_INPUT_CONSTANT_ADAPTER: TypeAdapter[ToolInputConstantValue] = TypeAdapter(ToolInputConstantValue)
_VARIABLE_SELECTOR_ADAPTER: TypeAdapter[VariableSelector] = TypeAdapter(VariableSelector)


class ToolEntity(BaseModel):
    provider_id: str
    provider_type: ToolProviderType
    provider_name: str  # redundancy
    tool_name: str
    tool_label: str  # redundancy
    tool_configurations: ToolConfigurations
    credential_id: str | None = None
    plugin_unique_identifier: str | None = None  # redundancy

    @field_validator("tool_configurations", mode="before")
    @classmethod
    def validate_tool_configurations(cls, value: object, _validation_info: ValidationInfo) -> ToolConfigurations:
        return _TOOL_CONFIGURATIONS_ADAPTER.validate_python(value)


class ToolNodeData(BaseNodeData, ToolEntity):
    type: NodeType = BuiltinNodeTypes.TOOL

    class ToolInput(BaseModel):
        type: Literal["mixed", "variable", "constant"]
        value: ToolInputConstantValue | VariableSelector

        @field_validator("value", mode="before")
        @classmethod
        def validate_value(
            cls, value: object, validation_info: ValidationInfo
        ) -> ToolInputConstantValue | VariableSelector:
            input_type = validation_info.data.get("type")
            if input_type == "mixed":
                return _TOOL_INPUT_MIXED_ADAPTER.validate_python(value)
            if input_type == "variable":
                return _VARIABLE_SELECTOR_ADAPTER.validate_python(value)
            if input_type == "constant":
                return _TOOL_INPUT_CONSTANT_ADAPTER.validate_python(value)
            raise ValueError(f"Unknown tool input type: {input_type}")

        def require_variable_selector(self) -> VariableSelector:
            if self.type != "variable":
                raise ValueError(f"Expected variable tool input, got {self.type}")
            return _VARIABLE_SELECTOR_ADAPTER.validate_python(self.value)

    tool_parameters: dict[str, ToolInput]
    # The version of the tool parameter.
    # If this value is None, it indicates this is a previous version
    # and requires using the legacy parameter parsing rules.
    tool_node_version: str | None = None

    @field_validator("tool_parameters", mode="before")
    @classmethod
    def filter_none_tool_inputs(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        return {
            key: tool_input
            for key, tool_input in value.items()
            if tool_input is not None and cls._has_valid_value(tool_input)
        }

    @staticmethod
    def _has_valid_value(tool_input: object) -> bool:
        """Check if the value is valid"""
        if isinstance(tool_input, dict):
            return tool_input.get("value") is not None
        if isinstance(tool_input, ToolNodeData.ToolInput):
            return tool_input.value is not None
        return False
