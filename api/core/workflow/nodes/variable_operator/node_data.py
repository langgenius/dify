from collections.abc import Sequence
from enum import Enum

from core.workflow.nodes.base import BaseNodeData


class WriteMode(str, Enum):
    OVER_WRITE = "over-write"
    APPEND = "append"
    CLEAR = "clear"


class VariableOperatorData(BaseNodeData):
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]
