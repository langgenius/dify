from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal, TypeAlias, cast

from pydantic import AfterValidator, BaseModel, Field, TypeAdapter, field_validator
from pydantic_core.core_schema import ValidationInfo

from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.nodes.base import BaseLoopNodeData, BaseLoopState
from dify_graph.utils.condition.entities import Condition
from dify_graph.variables.types import SegmentType

LoopValue: TypeAlias = str | int | float | bool | None | dict[str, Any] | list[Any]
LoopValueMapping: TypeAlias = dict[str, LoopValue]
VariableSelector: TypeAlias = list[str]

_VARIABLE_SELECTOR_ADAPTER: TypeAdapter[VariableSelector] = TypeAdapter(VariableSelector)

_VALID_VAR_TYPE = frozenset(
    [
        SegmentType.STRING,
        SegmentType.NUMBER,
        SegmentType.OBJECT,
        SegmentType.BOOLEAN,
        SegmentType.ARRAY_STRING,
        SegmentType.ARRAY_NUMBER,
        SegmentType.ARRAY_OBJECT,
        SegmentType.ARRAY_BOOLEAN,
    ]
)


def _is_valid_var_type(seg_type: SegmentType) -> SegmentType:
    if seg_type not in _VALID_VAR_TYPE:
        raise ValueError(...)
    return seg_type


def _validate_loop_value(value: object) -> LoopValue:
    if value is None or isinstance(value, (str, int, float, bool)):
        return cast(LoopValue, value)

    if isinstance(value, list):
        return [_validate_loop_value(item) for item in value]

    if isinstance(value, dict):
        normalized: dict[str, LoopValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("Loop values only support string object keys")
            normalized[key] = _validate_loop_value(item)
        return normalized

    raise TypeError("Loop values must be JSON-like primitives, arrays, or objects")


def _validate_loop_value_mapping(value: object) -> LoopValueMapping:
    if not isinstance(value, dict):
        raise TypeError("Loop outputs must be an object")

    normalized: LoopValueMapping = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError("Loop output keys must be strings")
        normalized[key] = _validate_loop_value(item)
    return normalized


class LoopVariableData(BaseModel):
    """
    Loop Variable Data.
    """

    label: str
    var_type: Annotated[SegmentType, AfterValidator(_is_valid_var_type)]
    value_type: Literal["variable", "constant"]
    value: LoopValue | VariableSelector | None = None

    @field_validator("value", mode="before")
    @classmethod
    def validate_value(cls, value: object, validation_info: ValidationInfo) -> LoopValue | VariableSelector | None:
        value_type = validation_info.data.get("value_type")
        if value_type == "variable":
            if value is None:
                raise ValueError("Variable loop inputs require a selector")
            return _VARIABLE_SELECTOR_ADAPTER.validate_python(value)
        if value_type == "constant":
            return _validate_loop_value(value)
        raise ValueError(f"Unknown loop variable value type: {value_type}")

    def require_variable_selector(self) -> VariableSelector:
        if self.value_type != "variable":
            raise ValueError(f"Expected variable loop input, got {self.value_type}")
        return _VARIABLE_SELECTOR_ADAPTER.validate_python(self.value)

    def require_constant_value(self) -> LoopValue:
        if self.value_type != "constant":
            raise ValueError(f"Expected constant loop input, got {self.value_type}")
        return _validate_loop_value(self.value)


class LoopNodeData(BaseLoopNodeData):
    type: NodeType = BuiltinNodeTypes.LOOP
    loop_count: int  # Maximum number of loops
    break_conditions: list[Condition]  # Conditions to break the loop
    logical_operator: Literal["and", "or"]
    loop_variables: list[LoopVariableData] | None = Field(default_factory=list[LoopVariableData])
    outputs: LoopValueMapping = Field(default_factory=dict)

    @field_validator("outputs", mode="before")
    @classmethod
    def validate_outputs(cls, value: object) -> LoopValueMapping:
        if value is None:
            return {}
        return _validate_loop_value_mapping(value)


class LoopStartNodeData(BaseNodeData):
    """
    Loop Start Node Data.
    """

    type: NodeType = BuiltinNodeTypes.LOOP_START


class LoopEndNodeData(BaseNodeData):
    """
    Loop End Node Data.
    """

    type: NodeType = BuiltinNodeTypes.LOOP_END


class LoopState(BaseLoopState):
    """
    Loop State.
    """

    outputs: list[LoopValue] = Field(default_factory=list)
    current_output: LoopValue | None = None

    class MetaData(BaseLoopState.MetaData):
        """
        Data.
        """

        loop_length: int

    def get_last_output(self) -> LoopValue | None:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None

    def get_current_output(self) -> LoopValue | None:
        """
        Get current output.
        """
        return self.current_output


class LoopCompletedReason(StrEnum):
    LOOP_BREAK = "loop_break"
    LOOP_COMPLETED = "loop_completed"
