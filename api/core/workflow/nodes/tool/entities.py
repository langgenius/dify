from typing import Any, Literal, Union

from pydantic import BaseModel, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.base.entities import BaseNodeData


class ToolEntity(BaseModel):
    provider_id: str
    provider_type: ToolProviderType
    provider_name: str  # redundancy
    tool_name: str
    tool_label: str  # redundancy
    tool_configurations: dict[str, Any]
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
        type: Literal["mixed", "variable", "constant"]

        @field_validator("type", mode="before")
        @classmethod
        def check_type(cls, value, validation_info: ValidationInfo):
            typ = value
            value = validation_info.data.get("value")
            if typ == "mixed" and not isinstance(value, str):
                raise ValueError("value must be a string")
            elif typ == "variable":
                if not isinstance(value, list):
                    raise ValueError("value must be a list")
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError("value must be a list of strings")
            elif typ == "constant" and not isinstance(value, str | int | float | bool):
                raise ValueError("value must be a string, int, float, or bool")
            return typ

    tool_parameters: dict[str, ToolInput]
