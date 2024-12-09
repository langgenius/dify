from typing import Any, Literal, Union
from pydantic import BaseModel, ValidationInfo, field_validator

from core.workflow.nodes.base.entities import BaseNodeData


class AgentEntity(BaseModel):
    agent_strategy_provider_name: str  # redundancy
    agent_strategy_name: str
    agent_strategy_label: str  # redundancy
    agent_configurations: dict[str, Any]
    plugin_unique_identifier: str

    @field_validator("agent_configurations", mode="before")
    @classmethod
    def validate_agent_configurations(cls, value, values: ValidationInfo):
        if not isinstance(value, dict):
            raise ValueError("agent_configurations must be a dictionary")

        for key in values.data.get("agent_configurations", {}):
            value = values.data.get("agent_configurations", {}).get(key)
            if not isinstance(value, str | int | float | bool):
                raise ValueError(f"{key} must be a string")

        return value


class AgentNodeData(BaseNodeData, AgentEntity):
    class AgentInput(BaseModel):
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

    agent_parameters: dict[str, AgentInput]
