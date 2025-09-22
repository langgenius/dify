from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    Field,
    field_validator,
)

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.variables.types import SegmentType
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.llm.entities import ModelConfig, VisionConfig

_OLD_BOOL_TYPE_NAME = "bool"
_OLD_SELECT_TYPE_NAME = "select"

_VALID_PARAMETER_TYPES = frozenset(
    [
        SegmentType.STRING,  # "string",
        SegmentType.NUMBER,  # "number",
        SegmentType.BOOLEAN,
        SegmentType.ARRAY_STRING,
        SegmentType.ARRAY_NUMBER,
        SegmentType.ARRAY_OBJECT,
        SegmentType.ARRAY_BOOLEAN,
        _OLD_BOOL_TYPE_NAME,  # old boolean type used by Parameter Extractor node
        _OLD_SELECT_TYPE_NAME,  # string type with enumeration choices.
    ]
)


def _validate_type(parameter_type: str) -> SegmentType:
    if parameter_type not in _VALID_PARAMETER_TYPES:
        raise ValueError(f"type {parameter_type} is not allowd to use in Parameter Extractor node.")

    if parameter_type == _OLD_BOOL_TYPE_NAME:
        return SegmentType.BOOLEAN
    elif parameter_type == _OLD_SELECT_TYPE_NAME:
        return SegmentType.STRING
    return SegmentType(parameter_type)


class ParameterConfig(BaseModel):
    """
    Parameter Config.
    """

    name: str
    type: Annotated[SegmentType, BeforeValidator(_validate_type)]
    options: list[str] | None = None
    description: str
    required: bool

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value) -> str:
        if not value:
            raise ValueError("Parameter name is required")
        if value in {"__reason", "__is_success"}:
            raise ValueError("Invalid parameter name, __reason and __is_success are reserved")
        return str(value)

    def is_array_type(self) -> bool:
        return self.type.is_array_type()

    def element_type(self) -> SegmentType:
        """Return the element type of the parameter.

        Raises a ValueError if the parameter's type is not an array type.
        """
        element_type = self.type.element_type()
        # At this point, self.type is guaranteed to be one of `ARRAY_STRING`,
        # `ARRAY_NUMBER`, `ARRAY_OBJECT`, or `ARRAY_BOOLEAN`.
        #
        # See: _VALID_PARAMETER_TYPES for reference.
        assert element_type is not None, f"the element type should not be None, {self.type=}"
        return element_type


class ParameterExtractorNodeData(BaseNodeData):
    """
    Parameter Extractor Node Data.
    """

    model: ModelConfig
    query: list[str]
    parameters: list[ParameterConfig]
    instruction: str | None = None
    memory: MemoryConfig | None = None
    reasoning_mode: Literal["function_call", "prompt"]
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @field_validator("reasoning_mode", mode="before")
    @classmethod
    def set_reasoning_mode(cls, v) -> str:
        return v or "function_call"

    def get_parameter_json_schema(self):
        """
        Get parameter json schema.

        :return: parameter json schema
        """
        parameters: dict[str, Any] = {"type": "object", "properties": {}, "required": []}

        for parameter in self.parameters:
            parameter_schema: dict[str, Any] = {"description": parameter.description}

            if parameter.type == SegmentType.STRING:
                parameter_schema["type"] = "string"
            elif parameter.type.is_array_type():
                parameter_schema["type"] = "array"
                element_type = parameter.type.element_type()
                if element_type is None:
                    raise AssertionError("element type should not be None.")
                parameter_schema["items"] = {"type": element_type.value}
            else:
                parameter_schema["type"] = parameter.type

            if parameter.options:
                parameter_schema["enum"] = parameter.options

            parameters["properties"][parameter.name] = parameter_schema

            if parameter.required:
                parameters["required"].append(parameter.name)

        return parameters
