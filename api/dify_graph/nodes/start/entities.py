from collections.abc import Sequence

from pydantic import Field

from dify_graph.enums import NodeType
from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.variables.input_entities import VariableEntity


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """

    type: NodeType = NodeType.START
    variables: Sequence[VariableEntity] = Field(default_factory=list)
