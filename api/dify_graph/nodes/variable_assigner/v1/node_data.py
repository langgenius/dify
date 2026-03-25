from collections.abc import Sequence
from enum import StrEnum

from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType


class WriteMode(StrEnum):
    OVER_WRITE = "over-write"
    APPEND = "append"
    CLEAR = "clear"


class VariableAssignerData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.VARIABLE_ASSIGNER
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]
