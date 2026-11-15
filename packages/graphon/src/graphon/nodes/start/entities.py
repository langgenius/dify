from collections.abc import Sequence

from pydantic import Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.variables.input_entities import VariableEntity


class StartNodeData(BaseNodeData):
    """Start Node Data"""

    type: NodeType = BuiltinNodeTypes.START
    variables: Sequence[VariableEntity] = Field(default_factory=list)
