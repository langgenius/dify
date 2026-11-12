from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.utils.condition.entities import Condition
from graphon.variables.types import SegmentType

_VALID_VAR_TYPE = frozenset([
    SegmentType.STRING,
    SegmentType.NUMBER,
    SegmentType.OBJECT,
    SegmentType.BOOLEAN,
    SegmentType.ARRAY_STRING,
    SegmentType.ARRAY_NUMBER,
    SegmentType.ARRAY_OBJECT,
    SegmentType.ARRAY_BOOLEAN,
])


def _is_valid_var_type(seg_type: SegmentType) -> SegmentType:
    if seg_type not in _VALID_VAR_TYPE:
        raise ValueError(...)
    return seg_type


class LoopVariableData(BaseModel):
    """Loop Variable Data."""

    label: str
    var_type: Annotated[SegmentType, AfterValidator(_is_valid_var_type)]
    value_type: Literal["variable", "constant"]
    value: Any


class LoopNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.LOOP
    start_node_id: str
    loop_count: int = Field(ge=1)  # Maximum number of loops
    break_conditions: list[Condition]  # Conditions to break the loop
    logical_operator: Literal["and", "or"]
    loop_variables: list[LoopVariableData] = Field(
        default_factory=list[LoopVariableData],
    )


class LoopStartNodeData(BaseNodeData):
    """Loop Start Node Data."""

    type: NodeType = BuiltinNodeTypes.LOOP_START


class LoopEndNodeData(BaseNodeData):
    """Loop End Node Data."""

    type: NodeType = BuiltinNodeTypes.LOOP_END
