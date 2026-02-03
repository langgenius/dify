from collections.abc import Sequence
from enum import StrEnum

from core.workflow.enums import NodeType
from core.workflow.nodes.base import BaseNodeData


class WriteMode(StrEnum):
    OVER_WRITE = "over-write"
    APPEND = "append"
    CLEAR = "clear"


class VariableAssignerData(BaseNodeData):
    type: NodeType = NodeType.VARIABLE_ASSIGNER
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]
