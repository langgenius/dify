from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator

from core.variables.types import SegmentType
from core.workflow.nodes.base import BaseLoopNodeData, BaseLoopState, BaseNodeData
from core.workflow.utils.condition.entities import Condition

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


class LoopVariableData(BaseModel):
    """
    Loop Variable Data.
    """

    label: str
    var_type: Annotated[SegmentType, AfterValidator(_is_valid_var_type)]
    value_type: Literal["variable", "constant"]
    value: Any | list[str] | None = None


class LoopNodeData(BaseLoopNodeData):
    loop_count: int  # Maximum number of loops
    break_conditions: list[Condition]  # Conditions to break the loop
    logical_operator: Literal["and", "or"]
    loop_variables: list[LoopVariableData] | None = Field(default_factory=list[LoopVariableData])
    outputs: dict[str, Any] = Field(default_factory=dict)

    @field_validator("outputs", mode="before")
    @classmethod
    def validate_outputs(cls, v):
        if v is None:
            return {}
        return v


class LoopStartNodeData(BaseNodeData):
    """
    Loop Start Node Data.
    """

    pass


class LoopEndNodeData(BaseNodeData):
    """
    Loop End Node Data.
    """

    pass


class LoopState(BaseLoopState):
    """
    Loop State.
    """

    outputs: list[Any] = Field(default_factory=list)
    current_output: Any = None

    class MetaData(BaseLoopState.MetaData):
        """
        Data.
        """

        loop_length: int

    def get_last_output(self) -> Any:
        """
        Get last output.
        """
        if self.outputs:
            return self.outputs[-1]
        return None

    def get_current_output(self) -> Any:
        """
        Get current output.
        """
        return self.current_output
