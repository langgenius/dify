from pydantic import BaseModel

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.variables.types import SegmentType


class AdvancedSettings(BaseModel):
    """Advanced setting."""

    group_enabled: bool

    class Group(BaseModel):
        """Group."""

        output_type: SegmentType
        variables: list[list[str]]
        group_name: str

    groups: list[Group]


class VariableAggregatorNodeData(BaseNodeData):
    """Variable Aggregator Node Data."""

    type: NodeType = BuiltinNodeTypes.VARIABLE_AGGREGATOR
    output_type: str
    variables: list[list[str]]
    advanced_settings: AdvancedSettings | None = None
