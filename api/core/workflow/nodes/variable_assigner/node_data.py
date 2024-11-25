from collections.abc import Sequence
from enum import StrEnum
from typing import Optional

from core.workflow.nodes.base import BaseNodeData


class WriteMode(StrEnum):
    OVER_WRITE = "over-write"
    APPEND = "append"
    CLEAR = "clear"


class VariableAssignerData(BaseNodeData):
    title: str = "Variable Assigner"
    desc: Optional[str] = "Assign a value to a variable"
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]
