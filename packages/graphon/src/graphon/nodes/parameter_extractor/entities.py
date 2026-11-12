from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    Field,
    field_validator,
)

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.llm.entities import ModelConfig, VisionConfig
from graphon.prompt_entities import MemoryConfig
from graphon.variables.types import SegmentType

_OLD_BOOL_TYPE_NAME = "bool"
_OLD_SELECT_TYPE_NAME = "select"

_VALID_PARAMETER_TYPES = frozenset([
    SegmentType.STRING,  # "string",
    SegmentType.NUMBER,  # "number",
    SegmentType.BOOLEAN,
    SegmentType.ARRAY_STRING,
    SegmentType.ARRAY_NUMBER,
    SegmentType.ARRAY_OBJECT,
    SegmentType.ARRAY_BOOLEAN,
    _OLD_BOOL_TYPE_NAME,  # old boolean type used by Parameter Extractor node
    _OLD_SELECT_TYPE_NAME,  # string type with enumeration choices.
])
_LEGACY_PARAMETER_TYPE_MAP: dict[str, SegmentType] = {
    _OLD_BOOL_TYPE_NAME: SegmentType.BOOLEAN,
    _OLD_SELECT_TYPE_NAME: SegmentType.STRING,
}


def _validate_type(parameter_type: str) -> SegmentType:
    if parameter_type not in _VALID_PARAMETER_TYPES:
        msg = f"type {parameter_type} is not allowd to use in Parameter Extractor node."
        raise ValueError(msg)
    legacy_type = _LEGACY_PARAMETER_TYPE_MAP.get(parameter_type)
    if legacy_type is not None:
        return legacy_type
    return SegmentType(parameter_type)


def _build_parameter_schema(parameter: "ParameterConfig") -> dict[str, Any]:
    parameter_schema: dict[str, Any] = {"description": parameter.description}

    if parameter.type == SegmentType.STRING:
        parameter_schema["type"] = "string"
    elif parameter.type.is_array_type():
        element_type = parameter.element_type()
        parameter_schema["type"] = "array"
        parameter_schema["items"] = {"type": element_type.value}
    else:
        parameter_schema["type"] = parameter.type

    if parameter.options:
        parameter_schema["enum"] = parameter.options

    return parameter_schema


class ParameterConfig(BaseModel):
    """Parameter Config."""

    name: str
    type: Annotated[SegmentType, BeforeValidator(_validate_type)]
    options: list[str] | None = None
    description: str
    required: bool

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: Any) -> str:
        if not value:
            msg = "Parameter name is required"
            raise ValueError(msg)
        if value in {"__reason", "__is_success"}:
            msg = "Invalid parameter name, __reason and __is_success are reserved"
            raise ValueError(msg)
        return str(value)

    def is_array_type(self) -> bool:
        return self.type.is_array_type()

    def element_type(self) -> SegmentType:
        """Return the element type of the parameter.

        Returns:
            The element `SegmentType` for the array parameter.

        Raises:
            ValueError: If the parameter type does not expose an array element type.
        """
        element_type = self.type.element_type()
        # At this point, self.type is guaranteed to be one of `ARRAY_STRING`,
        # `ARRAY_NUMBER`, `ARRAY_OBJECT`, or `ARRAY_BOOLEAN`.
        #
        # See: _VALID_PARAMETER_TYPES for reference.
        if element_type is None:
            msg = f"the element type should not be None, {self.type=}"
            raise ValueError(msg)
        return element_type


class ParameterExtractorNodeData(BaseNodeData):
    """Parameter Extractor Node Data."""

    type: NodeType = BuiltinNodeTypes.PARAMETER_EXTRACTOR
    model: ModelConfig
    query: list[str]
    parameters: list[ParameterConfig]
    instruction: str | None = None
    memory: MemoryConfig | None = None
    reasoning_mode: Literal["function_call", "prompt"]
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @field_validator("reasoning_mode", mode="before")
    @classmethod
    def set_reasoning_mode(cls, v: Any) -> str:
        return v or "function_call"

    def get_parameter_json_schema(self) -> dict[str, Any]:
        """Build the JSON schema used to validate extracted parameters."""
        parameters: dict[str, Any] = {
            "type": "object",
            "properties": {},
            "required": [],
        }

        for parameter in self.parameters:
            parameters["properties"][parameter.name] = _build_parameter_schema(
                parameter,
            )
            if parameter.required:
                parameters["required"].append(parameter.name)

        return parameters
