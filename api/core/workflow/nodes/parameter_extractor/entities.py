from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.llm import ModelConfig, VisionConfig


class ParameterConfig(BaseModel):
    """
    Parameter Config.
    """

    name: str
    type: Literal["string", "number", "bool", "select", "array[string]", "array[number]", "array[object]"]
    options: Optional[list[str]] = None
    description: str
    required: bool

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value) -> str:
        if not value:
            raise ValueError("Parameter name is required")
        if value in {"__reason", "__is_success"}:
            raise ValueError("Invalid parameter name, __reason and __is_success are reserved")
        return value


class ParameterExtractorNodeData(BaseNodeData):
    """
    Parameter Extractor Node Data.
    """

    model: ModelConfig
    query: list[str]
    parameters: list[ParameterConfig]
    instruction: Optional[str] = None
    memory: Optional[MemoryConfig] = None
    reasoning_mode: Literal["function_call", "prompt"]
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @field_validator("reasoning_mode", mode="before")
    @classmethod
    def set_reasoning_mode(cls, v) -> str:
        return v or "function_call"

    def get_parameter_json_schema(self) -> dict:
        """
        Get parameter json schema.

        :return: parameter json schema
        """
        parameters = {"type": "object", "properties": {}, "required": []}

        for parameter in self.parameters:
            parameter_schema: dict[str, Any] = {"description": parameter.description}

            if parameter.type in {"string", "select"}:
                parameter_schema["type"] = "string"
            elif parameter.type.startswith("array"):
                parameter_schema["type"] = "array"
                nested_type = parameter.type[6:-1]
                parameter_schema["items"] = {"type": nested_type}
            else:
                parameter_schema["type"] = parameter.type

            if parameter.type == "select":
                parameter_schema["enum"] = parameter.options

            parameters["properties"][parameter.name] = parameter_schema

            if parameter.required:
                parameters["required"].append(parameter.name)

        return parameters
