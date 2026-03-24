from collections.abc import Sequence

from pydantic import Field

from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.variables.input_entities import VariableEntity


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """

    type: NodeType = BuiltinNodeTypes.START
    variables: Sequence[VariableEntity] = Field(default_factory=list)
